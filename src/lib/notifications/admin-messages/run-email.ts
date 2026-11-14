import { batchIdempotencyKey } from "@/lib/admin/messages/idempotency";
import {
  MAX_RATE_LIMIT_RETRIES,
  type MassSendConfig,
  type MassSendIdentity,
} from "@/lib/email/mass-send-config";
import {
  buildMassEmail,
  createPacer,
  quotaRoom,
  streamFor,
  type Clock,
  type MassEmail,
  type MassMailProvider,
  type QuotaReading,
} from "@/lib/email/mass-send";
import { NOTIFICATION_FLAGS, type AdminRecipientOutcome } from "@/lib/notifications/contract";
import type { EmailRunRpcs, EmailSendStore, FlagReader, MessageForSend, RecipientDirectory, RecipientRecord } from "./ports";

/**
 * Sends one admin message's EMAIL channel, in paced batches.
 *
 * Read this top to bottom; the order of the steps inside a batch is the safety argument:
 *
 *   1. flags     master, admin_messaging, admin_email, and admin_promotions for a promotion, re-read for EVERY batch; any one off stops the run
 *   2. eligible  the database's email-eligibility function is asked about THIS batch's recipients, now. The batch endpoint is not covered by the deletion guard in getResendClient, so
 *                a deleted, deleting, QA, opted-out, unconfirmed or blank-address account is dropped here and recorded with its outcome. Nobody is trusted from Prepare time.
 *   3. claim     each remaining recipient is claimed in the delivery ledger BEFORE the request. The database holds the rolling 24-hour cap and the monthly ceiling under a lock
 *                (the claim function in the contract), so this cannot be raced. A refused claim for the cap or the ceiling sends what is already claimed, PAUSES the message, and leaves
 *                every later recipient queued. It never sends anyway.
 *   4. pace      wait until the gap since the start of the last request has passed (never two requests in flight: each is awaited), then read the flags once more, because the wait
 *                is the longest gap between a flag check and a send
 *   5. send      one request, one recipient per email object, with an idempotency key derived from the recipient set. Re-sending the same set is safe.
 *
 * What it will never do: release an email claim (a claim whose outcome is unknown is left open for a person to resolve), retry a recipient whose claim is open (it skips them),
 * or write an address anywhere (logs carry counts, the message id and the subject).
 */

export type EmailRunStatus =
  | "finished"
  | "held_open_claims"
  | "paused_email_cap"
  | "paused_email_ceiling"
  | "stopped_flag"
  | "stopped_provider_quota"
  | "stopped_rate_limit"
  | "stopped_unknown_outcome"
  | "stopped_provider_rejected"
  | "stopped_unexpected_refusal"
  | "refused_start"
  | "not_sending"
  | "no_email_channel";

export type EmailRunResult = {
  status: EmailRunStatus;
  /** Why a start was refused, or what stopped the run. A fixed code, never database or provider text. */
  reason: string | null;
  sent: number;
  failed: number;
  skipped: number;
  /** Recipients left alone because their email claim from an earlier attempt is still open. */
  heldByOpenClaim: number;
  /** Recipients whose email outcome is still empty when the run ends. */
  remainingQueued: number;
  batches: number;
};

export type EmailRunDeps = {
  rpcs: EmailRunRpcs;
  store: EmailSendStore;
  directory: RecipientDirectory;
  provider: MassMailProvider;
  flags: FlagReader;
  clock: Clock;
  /** One line per call. The runner passes counts, the message id and the subject, and nothing else. */
  log: (line: string) => void;
  /** Null when `MASS_EMAIL_FROM` is not configured: the run refuses to start. */
  identity: MassSendIdentity | null;
  config: MassSendConfig;
};

export type EmailRunOptions = {
  /** Finish the message when the email channel is done. Defaults to true only for a message whose channels are email alone. */
  finishWhenDone?: boolean;
};

const MIN_REMAINING_TO_START = 1;

async function flagsOpen(deps: EmailRunDeps, message: MessageForSend): Promise<boolean> {
  const required: string[] = [NOTIFICATION_FLAGS.master, NOTIFICATION_FLAGS.adminMessaging, NOTIFICATION_FLAGS.adminEmail];
  if (message.kind === "promotion") required.push(NOTIFICATION_FLAGS.adminPromotions);
  for (const key of required) {
    try {
      if (!(await deps.flags(key))) return false;
    } catch {
      return false; // a flag that cannot be read is a flag that is off
    }
  }
  return true;
}

function emptyResult(status: EmailRunStatus, reason: string | null, queued = 0): EmailRunResult {
  return { status, reason, sent: 0, failed: 0, skipped: 0, heldByOpenClaim: 0, remainingQueued: queued, batches: 0 };
}

export async function runEmailSend(deps: EmailRunDeps, messageId: string, options: EmailRunOptions = {}): Promise<EmailRunResult> {
  const { rpcs, store, directory, provider, clock, log } = deps;
  const message = await store.getMessage(messageId);
  if (!message) return emptyResult("not_sending", "unknown_message");
  const subject = JSON.stringify(message.title);

  if (!message.channels.includes("email")) return emptyResult("no_email_channel", null);
  // Only a message that is sending runs. A paused message stays paused until a person resumes it, so a second run of a paused message sends nothing.
  if (message.status !== "sending") return emptyResult("not_sending", message.status);

  const stream = streamFor(message.kind);
  const queued = await store.queuedEmailRecipientIds(message.id);

  const refuse = (reason: string): EmailRunResult => {
    log(`[mass-email] refused message=${message.id} subject=${subject} reason=${reason} queued=${queued.length}`);
    return emptyResult("refused_start", reason, queued.length);
  };

  if (!(await flagsOpen(deps, message))) {
    log(`[mass-email] stopped message=${message.id} subject=${subject} reason=flag_off queued=${queued.length}`);
    return emptyResult("stopped_flag", "flag_off", queued.length);
  }
  if (!deps.identity) return refuse("no_sender_identity");

  // Refuses to start without the provider's quota: absent headers mean "do not know how much is left", and not knowing is not permission.
  let quota: QuotaReading | null = await provider.readQuota();
  let room = quotaRoom(quota);
  if (room === null) return refuse("quota_headers_absent");
  if (room < MIN_REMAINING_TO_START) return refuse("provider_quota_exhausted");

  const pacer = createPacer(clock, deps.config.gapMs);
  const result = emptyResult("finished", null, queued.length);
  const held = new Set<string>();
  let settled = 0;
  let cursor = 0;

  log(`[mass-email] start message=${message.id} subject=${subject} queued=${queued.length}`);

  const progress = async (sent: number, failed: number, skipped: number) => {
    if (sent + failed + skipped === 0) return;
    await rpcs.recordAdminMessageProgress({ p_message: message.id, p_sent: sent, p_failed: failed, p_skipped: skipped });
  };

  const stop = (status: EmailRunStatus, reason: string): EmailRunResult => {
    result.status = status;
    result.reason = reason;
    result.heldByOpenClaim = held.size;
    result.remainingQueued = queued.length - settled;
    log(
      `[mass-email] stopped message=${message.id} subject=${subject} reason=${reason} sent=${result.sent} failed=${result.failed} skipped=${result.skipped} held=${held.size} queued=${result.remainingQueued}`,
    );
    return result;
  };

  while (cursor < queued.length) {
    // 2. flags, for every batch
    if (!(await flagsOpen(deps, message))) return stop("stopped_flag", "flag_off");

    room = quotaRoom(quota);
    if (room !== null && room < MIN_REMAINING_TO_START) return stop("stopped_provider_quota", "provider_quota_exhausted");
    const size = room === null ? deps.config.perRequest : Math.min(deps.config.perRequest, room);
    const chunk = queued.slice(cursor, cursor + size);
    cursor += chunk.length;

    // 3. eligibility, asked now, for this batch
    const eligibleIds = new Set(await rpcs.adminEmailEligibleRecipients({ p_user_ids: chunk, p_stream: stream }));
    const records = await directory.lookup(chunk, stream);
    const dropped: Record<string, string[]> = {};
    for (const id of chunk) {
      if (eligibleIds.has(id)) continue;
      const outcome = classifyDropped(records.get(id));
      (dropped[outcome] ??= []).push(id);
    }
    let batchSkipped = 0;
    for (const [outcome, ids] of Object.entries(dropped)) {
      await store.setEmailOutcome(message.id, ids, outcome as AdminRecipientOutcome);
      batchSkipped += ids.length;
      settled += ids.length;
    }
    result.skipped += batchSkipped;

    // 4. claim, one recipient at a time, before any request
    const claimed: { userId: string; claimId: string }[] = [];
    let limitHit: "cap_24h" | "ceiling_month" | null = null;
    let unexpected = false;
    for (const id of chunk) {
      if (!eligibleIds.has(id)) continue;
      const claim = await rpcs.claimNotification({ p_user: id, p_kind: "admin_message", p_subject: message.id, p_channel: "email" });
      if (claim.id !== null) {
        claimed.push({ userId: id, claimId: claim.id });
      } else if (claim.refused === "already_claimed") {
        held.add(id); // an earlier attempt claimed this person and its outcome is unknown: leave them alone
      } else if (claim.refused === "cap_24h" || claim.refused === "ceiling_month") {
        limitHit = claim.refused;
        break;
      } else {
        unexpected = true;
        break;
      }
    }

    // 5. send what was claimed
    let sentNow = 0;
    let unaddressableNow = 0;
    if (claimed.length > 0) {
      const outcome = await sendClaimed(deps, message, stream, claimed, records, pacer);
      if (outcome.kind === "stop") {
        await progress(0, outcome.failed, batchSkipped);
        result.failed += outcome.failed;
        settled += outcome.failed;
        return stop(outcome.status, outcome.reason);
      }
      sentNow = outcome.sent;
      unaddressableNow = outcome.unaddressable;
      // The provider's own report wins; without one, count down from what was known.
      if (outcome.quota) quota = outcome.quota;
      else if (room !== null) quota = { rateRemaining: null, dailyRemaining: Math.max(0, room - outcome.sent), monthlyRemaining: null };
      settled += outcome.sent + outcome.unaddressable;
      result.sent += outcome.sent;
      result.skipped += outcome.unaddressable;
      result.batches += 1;
      log(`[mass-email] batch message=${message.id} subject=${subject} sent=${outcome.sent} skipped=${batchSkipped + outcome.unaddressable} queued=${queued.length - settled}`);
    }
    await progress(sentNow, 0, batchSkipped + unaddressableNow);

    if (limitHit) {
      await rpcs.pauseAdminMessageSend({ p_message: message.id, p_reason: limitHit });
      return stop(limitHit === "cap_24h" ? "paused_email_cap" : "paused_email_ceiling", limitHit);
    }
    if (unexpected) return stop("stopped_unexpected_refusal", "unexpected_refusal");
  }

  result.heldByOpenClaim = held.size;
  result.remainingQueued = queued.length - settled;
  if (result.remainingQueued > 0 || held.size > 0) {
    result.status = "held_open_claims";
    result.reason = "open_claims";
    log(`[mass-email] done message=${message.id} subject=${subject} sent=${result.sent} skipped=${result.skipped} held=${held.size} queued=${result.remainingQueued}`);
    return result;
  }

  const finish = options.finishWhenDone ?? message.channels.every((c) => c === "email");
  if (finish) await rpcs.finishAdminMessageSend({ p_message: message.id });
  log(`[mass-email] done message=${message.id} subject=${subject} sent=${result.sent} skipped=${result.skipped} held=0 queued=0`);
  return result;
}

function classifyDropped(record: RecipientRecord | undefined): AdminRecipientOutcome {
  if (!record || !record.present || record.deleting) return "skipped_deleted";
  if (record.optedOut) return "skipped_opted_out";
  return "skipped_inactive";
}

type SendOutcome =
  | { kind: "sent"; sent: number; unaddressable: number; quota: QuotaReading | null }
  | { kind: "stop"; status: EmailRunStatus; reason: string; failed: number };

async function sendClaimed(
  deps: EmailRunDeps,
  message: MessageForSend,
  stream: ReturnType<typeof streamFor>,
  claimed: { userId: string; claimId: string }[],
  records: Map<string, RecipientRecord>,
  pacer: ReturnType<typeof createPacer>,
): Promise<SendOutcome> {
  const { rpcs, store, provider, clock } = deps;
  const emails: MassEmail[] = [];
  const sendable: { userId: string; claimId: string }[] = [];
  const unaddressable: string[] = [];
  for (const c of claimed) {
    const record = records.get(c.userId);
    if (!record?.email || !record.unsubscribeToken) {
      unaddressable.push(c.userId);
      continue;
    }
    emails.push(
      buildMassEmail({
        identity: deps.identity!,
        to: record.email,
        subject: message.title,
        body: message.body,
        linkPath: message.link_path,
        stream,
        unsubscribeToken: record.unsubscribeToken,
        consentLine: message.consent_line,
        firstName: record.firstName,
      }),
    );
    sendable.push(c);
  }
  // A claimed person with no address or token on file cannot be mailed. Their claim stays open (an email claim is never released) and they are recorded as skipped.
  if (unaddressable.length > 0) await store.setEmailOutcome(message.id, unaddressable, "skipped_inactive");
  if (sendable.length === 0) return { kind: "sent", sent: 0, unaddressable: unaddressable.length, quota: null };

  const key = batchIdempotencyKey(message.id, sendable.map((c) => c.userId));
  let attempt = 0;
  for (;;) {
    await pacer.beforeRequest();
    if (!(await flagsOpen(deps, message))) return { kind: "stop", status: "stopped_flag", reason: "flag_off", failed: 0 };
    const answer = await provider.sendBatch(emails, { idempotencyKey: key });
    pacer.observe("quota" in answer ? answer.quota : null);

    if (answer.kind === "ok") {
      await store.setEmailOutcome(message.id, sendable.map((c) => c.userId), "sent");
      for (const c of sendable) await rpcs.markNotificationSent({ p_id: c.claimId });
      return { kind: "sent", sent: sendable.length, unaddressable: unaddressable.length, quota: answer.quota };
    }
    if (answer.kind === "quota_exceeded") return { kind: "stop", status: "stopped_provider_quota", reason: `provider_${answer.scope}_quota`, failed: 0 };
    if (answer.kind === "rejected") {
      await store.setEmailOutcome(message.id, sendable.map((c) => c.userId), "failed");
      return { kind: "stop", status: "stopped_provider_rejected", reason: "provider_rejected", failed: sendable.length };
    }
    if (answer.kind === "rate_limited") {
      if (attempt >= MAX_RATE_LIMIT_RETRIES) return { kind: "stop", status: "stopped_rate_limit", reason: "rate_limited", failed: 0 };
      attempt += 1;
      // The provider named a time; honour it, never less than the normal gap. The retry carries the SAME key.
      await clock.sleep(Math.max(0, (answer.retryAfterSec ?? 0) * 1000));
      continue;
    }
    // unknown: nobody knows whether the provider accepted the request. Claims stay open; a person resolves them.
    return { kind: "stop", status: "stopped_unknown_outcome", reason: "unknown_outcome", failed: 0 };
  }
}
