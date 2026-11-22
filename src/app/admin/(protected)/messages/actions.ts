"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/admin/require-admin";
import { getMessagingService, MessagingError, type AdminActor } from "@/lib/admin/messages";
import { sendAdminMessageEmail } from "@/lib/notifications/admin-messages";
import {
  ADMIN_MESSAGE_KINDS,
  ADMIN_SEGMENT_KEYS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SETTING_KEYS,
  STALE_CLAIM_RESOLUTIONS,
  type AdminMessageKind,
  type AdminSegmentKey,
  type AdminSegmentParams,
  type NotificationChannel,
  type NotificationSettingKey,
  type StaleClaimResolution,
} from "@/lib/notifications/contract";
import { pausedSentence, RAISING_A_LIMIT_NOTE, SWITCHED_OFF_NOTICE } from "@/components/admin/messages/texts";
import { SELF_SEND_CONFIRM_WORD, needsTypedSend, typedSendSentence } from "@/lib/admin/messages/self-send";
import { sendTestEmail } from "./test-send";
import type { MessageActionState } from "@/components/admin/messages/state";

/**
 * The admin messaging Server Actions.
 *
 * EVERY ACTION CALLS `requirePermission` FIRST, before it reads the form or touches the service. A Server Action is reachable by a POST that never renders the page, so the page's own
 * guard is not enough (admin-nav.tsx says the same of the nav: a link is not a control). The actor handed to the service is built from that verified session and from nothing the
 * form says, and the rules themselves (the two-person rule, the kind confirmation, the flags, the limits) are the database's: this file reads a form, asks, and turns a closed
 * reason into a sentence.
 *
 * `requirePermission` redirects an operator without the permission, so a refused holder never reaches the lines below it.
 */

const REASON_SENTENCES: Record<string, string> = {
  self_approval: "You wrote this message, so someone else has to approve it. Ask another operator.",
  kind_not_confirmed: "That is not the kind of this message. Check the kind shown at the top and tick the box again.",
  invalid_state: "This message is not in the right state for that step. Reload the page to see where it is.",
  not_found: "That message no longer exists.",
  consent_required: "A promotion cannot go out without its consent line.",
  audience_over_limit: "That audience is bigger than one message may reach.",
  operator_daily_limit: "You have reached the number of messages one operator may send in a day.",
  overall_daily_limit: "The number of messages that may go out today has been reached.",
  flag_off: "Admin messaging is switched off.",
};

function sentenceFor(error: unknown): string {
  if (error instanceof MessagingError) {
    if (error.code === "permission_denied") return "You do not have permission to do that.";
    if (error.code === "switched_off") return `${error.message.charAt(0).toUpperCase()}${error.message.slice(1)}.`;
    if (error.code === "invalid_input") return `${error.message.charAt(0).toUpperCase()}${error.message.slice(1)}.`;
    return (error.reason && REASON_SENTENCES[error.reason]) || "The database refused that step.";
  }
  console.error("[admin-messages] unexpected failure");
  return "Something went wrong on our end.";
}

async function session(): Promise<AdminActor> {
  const admin = await requirePermission("user_messaging");
  return { adminId: admin.adminId, permissions: admin.permissions };
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function done(id: string, message: string): MessageActionState {
  revalidatePath("/admin/messages");
  revalidatePath(`/admin/messages/${id}`);
  return { status: "success", message, targetId: id };
}
function failed(id: string, error: unknown): MessageActionState {
  return { status: "error", message: sentenceFor(error), targetId: id };
}

/* ------------------------------------------------------------------ */

function composeInput(formData: FormData) {
  const kind = field(formData, "kind") as AdminMessageKind;
  const channels = formData.getAll("channels").map(String) as NotificationChannel[];
  const segmentKey = field(formData, "segmentKey") as AdminSegmentKey;
  const params: AdminSegmentParams = {};
  const days = Number(field(formData, "segmentDays"));
  if (segmentKey === "inactive_seekers" && (days === 30 || days === 60 || days === 90)) params.days = days;
  const since = field(formData, "segmentSince");
  if (segmentKey === "signed_up_since" && since) params.since = since;
  const country = field(formData, "segmentCountry");
  if (segmentKey === "country" && country) params.country = country;
  return {
    kind,
    title: field(formData, "title"),
    body: field(formData, "body"),
    linkPath: field(formData, "linkPath") || null,
    channels,
    segmentKey,
    segmentParams: params,
    consentLine: field(formData, "consentLine") || null,
  };
}

export async function composeAction(_prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const actor = await session();
  const input = composeInput(formData);
  if (!ADMIN_MESSAGE_KINDS.includes(input.kind) || !ADMIN_SEGMENT_KEYS.includes(input.segmentKey) || input.channels.some((c) => !NOTIFICATION_CHANNELS.includes(c))) {
    return { status: "error", message: "Pick a kind, an audience and at least one channel.", targetId: "new" };
  }
  let id: string;
  try {
    id = await getMessagingService().compose(actor, input);
  } catch (error) {
    return failed("new", error);
  }
  revalidatePath("/admin/messages");
  redirect(`/admin/messages/${id}`);
}

export async function prepareAction(_prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const actor = await session();
  const id = field(formData, "id");
  try {
    const count = await getMessagingService().prepare(actor, id);
    return done(id, `Prepared. The audience is frozen at ${count} ${count === 1 ? "person" : "people"}; the counts below are what will be sent.`);
  } catch (error) {
    return failed(id, error);
  }
}

export async function testSendAction(_prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const admin = await requirePermission("user_messaging");
  const actor: AdminActor = { adminId: admin.adminId, permissions: admin.permissions };
  const id = field(formData, "id");
  try {
    const service = getMessagingService();
    await service.recordTest(actor, id);
    const message = await service.get(actor, id);
    if (!message) return { status: "error", message: "That message no longer exists.", targetId: id };
    // The test reaches the signed-in operator's own address and nobody else's.
    const outcome = await sendTestEmail(message, admin.email);
    return done(id, outcome);
  } catch (error) {
    return failed(id, error);
  }
}

export async function submitAction(_prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const actor = await session();
  const id = field(formData, "id");
  try {
    await getMessagingService().submit(actor, id);
    return done(id, "Submitted. Another operator now has to approve it.");
  } catch (error) {
    return failed(id, error);
  }
}

export async function approveAction(_prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const actor = await session();
  const id = field(formData, "id");
  const kind = field(formData, "kind") as AdminMessageKind;
  // The tick is the approver saying, out loud, what KIND of message this is. Without it nothing is asked of the database.
  if (formData.get("confirmKind") !== "yes") {
    return { status: "error", message: "Tick the box to confirm the kind of message you are approving.", targetId: id };
  }
  if (!ADMIN_MESSAGE_KINDS.includes(kind)) return { status: "error", message: "Reload the page: the kind of this message was not sent.", targetId: id };
  try {
    await getMessagingService().approve(actor, id, kind);
    return done(id, "Approved. It can be sent now.");
  } catch (error) {
    return failed(id, error);
  }
}

export async function cancelAction(_prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const actor = await session();
  const id = field(formData, "id");
  try {
    await getMessagingService().cancel(actor, id);
    return done(id, "Cancelled. Nothing will be sent.");
  } catch (error) {
    return failed(id, error);
  }
}

/** Starts the send, then runs the email channel. A repeat or a double click starts nothing: the database returns no id the second time. */
export async function sendAction(_prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const actor = await session();
  const id = field(formData, "id");
  try {
    const service = getMessagingService();
    // A message sent without a second approver to more than 50 people needs the word SEND, typed. This is the guard (the page's input only supplies the word); a message that went through the two-person route is not asked.
    const pending = await service.get(actor, id);
    // Fail closed: a message that cannot be read is not sent (without it, a failed read would skip the check below).
    if (!pending) return { status: "error", message: "That message could not be read, so nothing was sent.", targetId: id };
    if (needsTypedSend(pending) && field(formData, "confirmSend") !== SELF_SEND_CONFIRM_WORD) {
      return { status: "error", message: typedSendSentence(pending.audience_count), targetId: id };
    }
    const started = await service.start(actor, id);
    if (started === null) {
      return { status: "error", message: "Nothing was started. It may already have been sent, or a switch it needs is off.", targetId: id };
    }
    const message = await service.get(actor, id);
    if (message?.channels.includes("email")) return done(id, await runEmail(id, actor));
    return done(id, "Started.");
  } catch (error) {
    return failed(id, error);
  }
}

/** Runs the email channel again for a message that is sending, for example after a provider stop or after a resume. Open claims are skipped, never re-sent. */
export async function continueEmailAction(_prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const actor = await session();
  const id = field(formData, "id");
  try {
    const service = getMessagingService();
    if (!(await service.switches(actor)).sendPathOpen) return { status: "error", message: SWITCHED_OFF_NOTICE, targetId: id };
    const message = await service.get(actor, id);
    if (!message || message.status !== "sending") return { status: "error", message: "This message is not sending.", targetId: id };
    return done(id, await runEmail(id, actor));
  } catch (error) {
    return failed(id, error);
  }
}

async function runEmail(id: string, actor: AdminActor): Promise<string> {
  const result = await sendAdminMessageEmail(id);
  const counts = `${result.sent} sent, ${result.skipped} skipped, ${result.remainingQueued} still queued`;
  switch (result.status) {
    case "finished":
      return `Email finished: ${counts}.`;
    case "held_open_claims":
      return `Email stopped short: ${counts}. Some people have an open email claim from an earlier attempt and are left alone until a person resolves it below.`;
    case "paused_email_cap":
    case "paused_email_ceiling":
      return `${pausedSentence(result.status, await getMessagingService().limits(actor))} (${counts}.)`;
    case "refused_start":
      return result.reason === "no_sender_identity"
        ? "Email did not start: no sender address is configured."
        : result.reason === "provider_quota_exhausted"
          ? "Email did not start: the mail provider has no room left."
          : "Email did not start: the mail provider's quota could not be read.";
    case "stopped_flag":
      return `Email stopped because a switch it needs was turned off (${counts}).`;
    case "stopped_provider_quota":
      return `Email stopped: the mail provider's quota is used up (${counts}). Nothing was dropped.`;
    case "stopped_rate_limit":
      return `Email stopped: the mail provider kept asking us to slow down (${counts}).`;
    case "stopped_unknown_outcome":
      return `Email stopped: the provider did not say whether the last batch went out (${counts}). Those people are left alone until a person resolves them below.`;
    case "stopped_provider_rejected":
      return `Email stopped: the provider refused the last batch (${counts}).`;
    case "not_sending":
      return "This message is not sending.";
    default:
      return `Email stopped (${counts}).`;
  }
}

export async function resumeAction(_prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const actor = await session();
  const id = field(formData, "id");
  try {
    await getMessagingService().resume(actor, id);
    return done(id, "Resumed. Press Continue sending to send the people still queued.");
  } catch (error) {
    return failed(id, error);
  }
}

export async function resolveClaimAction(_prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const actor = await session();
  const claimId = field(formData, "claimId");
  const resolution = field(formData, "resolution") as StaleClaimResolution;
  if (!STALE_CLAIM_RESOLUTIONS.includes(resolution)) return { status: "error", message: "Pick mark sent or release for retry.", targetId: claimId };
  try {
    await getMessagingService().resolveStaleClaim(actor, claimId, resolution);
    revalidatePath("/admin/messages");
    return { status: "success", message: resolution === "mark_sent" ? "Marked as sent." : "Released: a later run may try that person again.", targetId: claimId };
  } catch (error) {
    return failed(claimId, error);
  }
}

/** Super Admin only. Changes a limit and nothing else: it never resumes a paused message. */
export async function setLimitAction(_prev: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const admin = await requirePermission("operators");
  const actor: AdminActor = { adminId: admin.adminId, permissions: admin.permissions };
  const key = field(formData, "key") as NotificationSettingKey;
  const value = Number(field(formData, "value"));
  if (!NOTIFICATION_SETTING_KEYS.includes(key)) return { status: "error", message: "Unknown limit.", targetId: key };
  if (!Number.isInteger(value)) return { status: "error", message: "A limit is a whole number.", targetId: key };
  try {
    await getMessagingService().setLimit(actor, key, value);
    revalidatePath("/admin/messages");
    return { status: "success", message: `Saved, and the change is logged. ${RAISING_A_LIMIT_NOTE}`, targetId: key };
  } catch (error) {
    return failed(key, error);
  }
}
