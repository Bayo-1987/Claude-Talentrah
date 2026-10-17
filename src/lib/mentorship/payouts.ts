import "server-only";
import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { initiateTransfer, verifyTransfer, isDecline } from "@/lib/paystack/client";
import { completeFinishedSessions } from "@/lib/mentorship/sweep";
import type { Database } from "@/lib/supabase/types";

/**
 * Mentor payouts — Mentorship v2, part 1 (0149). Read 0149's own migration
 * header before touching this file: it records the hold-window and
 * bad-review-clawback decisions this module enforces.
 *
 * ── THE CLAIM-THEN-ACT SHAPE, RESTATED HERE BECAUSE IT IS THE WHOLE POINT ──
 *
 * `attemptPayout` is the one function that ever calls Paystack's Transfer
 * API for a given payout row, and it is safe to call it concurrently, any
 * number of times, from any caller (the cron loop below, or an admin's
 * manual retry in src/lib/admin/mentor-payouts/actions.ts) — because the
 * FIRST thing it does is `claim_mentor_payout` (0149), one atomic
 * `UPDATE ... WHERE status IN ('pending','failed') ... RETURNING`. A caller
 * that gets no row back did not win the claim and does nothing further. This
 * is the same reasoning book_mentor_session (0133) and spend_credits_atomic
 * (0035) already rely on — a read-then-write in JS is not a gate, only a
 * single conditional statement is.
 *
 * ── WHY "INDETERMINATE" IS A THIRD OUTCOME, NOT COLLAPSED INTO SUCCESS/FAIL ──
 *
 * Same reasoning src/lib/billing/renewals.ts already documents for Pass
 * renewals: a network failure, a Paystack 5xx, or Paystack's own "pending"/
 * "otp" transfer status say NOTHING about whether the money actually moved.
 * Treating any of those as "failed" risks abandoning a transfer Paystack may
 * still complete (this is real money leaving Talentrah's account — an
 * abandoned reference is not a bookkeeping nicety); treating them as
 * "success" risks confirming a payout that never happened. Both are wrong in
 * different, expensive directions, so this module keeps the row exactly
 * where it is — reference retained, status back to `pending` — until a later
 * verify call actually learns the outcome.
 *
 * ── THE REFERENCE IS SAVED BEFORE THE MONEY MOVES (PAYOUT-RENEWAL-UNCHECKED-WRITES-1) ──
 *
 * `attemptPayout` writes the transfer reference onto the row, checked, BEFORE it asks Paystack for the transfer. If that write fails, no transfer is requested.
 * Before this, the reference lived only in memory until an outcome was known, so a transfer that succeeded followed by a failed status write (or a dead process)
 * left a `processing` row with no reference, and the next claim would have minted a NEW reference and paid the mentor again. Now every row that could have sent money carries the
 * thread back to it, a retry verifies that reference first, and a processing row WITHOUT one is never sent (`needs_review`).
 *
 * Every terminal write is checked for an error and for exactly one matching row; a failure is reported as an `*_unrecorded` outcome, never as the success it was meant to record.
 *
 * The 72-hour hold window itself is enforced in SQL, not here —
 * `sync_mentor_payout_rows` (0149) sets `eligible_at` at row-creation time,
 * so this module never has to recompute or re-check it.
 */

/** Mirrors MAX_INDETERMINATE_RENEWAL_ATTEMPTS's own reasoning (src/lib/billing/renewals.ts): three unresolved attempts is no longer plausibly transient. */
export const MAX_INDETERMINATE_PAYOUT_ATTEMPTS = 3;

export interface MentorPayoutJobSummary {
  ok: boolean;
  rowsCreated: number;
  attempted: number;
  paid: number;
  indeterminate: number;
  failed: number;
  /** Outcomes the database does not show: money may have moved (or not), and the record could not be written. NEVER counted as paid. Each one also sets `ok` false and is listed in `errors`. */
  unrecorded: number;
  /** Attempts that stopped before any money moved because the reference could not be saved first. */
  referenceUnsaved: number;
  /** Rows stuck at `processing` with no reference on record: a person has to look; nothing is sent automatically. */
  needsReview: number;
  errors: Array<{ payoutId: string; message: string }>;
}

export function newPayoutJobSummary(): MentorPayoutJobSummary {
  return { ok: true, rowsCreated: 0, attempted: 0, paid: 0, indeterminate: 0, failed: 0, unrecorded: 0, referenceUnsaved: 0, needsReview: 0, errors: [] };
}

/**
 * What one attempt's outcome does to the job summary. The point of the function: an outcome that means "the record does not show what happened" is never a quiet success. It is listed
 * with the payout id in `errors` and sets `ok` false, which src/app/api/admin/mentor-payouts/route.ts turns into HTTP 500 so the scheduler's failure alerting fires.
 */
export function recordOutcomeInSummary(summary: MentorPayoutJobSummary, payoutId: string, outcome: PayoutAttemptOutcome): void {
  switch (outcome.outcome) {
    case "paid":
      summary.paid += 1;
      return;
    case "indeterminate":
      summary.indeterminate += 1;
      return;
    case "failed":
      summary.failed += 1;
      return;
    case "not_eligible":
      return;
    case "paid_unrecorded":
      summary.unrecorded += 1;
      summary.ok = false;
      summary.errors.push({
        payoutId,
        message: `Paid at Paystack but not recorded: the payout row still says in progress. Do NOT retry blindly. Reference ${outcome.reference}, transfer ${outcome.transferCode}.`,
      });
      return;
    case "failure_unrecorded":
      summary.unrecorded += 1;
      summary.ok = false;
      summary.errors.push({ payoutId, message: `A failure was not recorded (${outcome.reason}); the payout row still says in progress.` });
      return;
    case "indeterminate_unrecorded":
      summary.unrecorded += 1;
      summary.ok = false;
      summary.errors.push({ payoutId, message: `Paystack has not confirmed an outcome and that was not recorded; reference ${outcome.reference} is still on the row.` });
      return;
    case "reference_unsaved":
      summary.referenceUnsaved += 1;
      summary.ok = false;
      summary.errors.push({ payoutId, message: "The transfer reference could not be saved, so nothing was sent. It will be tried again." });
      return;
    case "needs_review":
      summary.needsReview += 1;
      summary.ok = false;
      summary.errors.push({ payoutId, message: "Stuck in progress with no Paystack reference on record: a person must check Paystack's dashboard. Nothing is sent automatically." });
      return;
  }
}

/**
 * The batch cron entry point (src/app/api/admin/mentor-payouts/route.ts).
 * BATCH row-selection, PER-SESSION atomic claim+attempt — same shape as
 * runPassRenewalJob and runMentorshipSweep: one work-list query, then a loop
 * where each row's own fate is decided by one atomic statement.
 */
export async function runMentorPayoutJob(): Promise<MentorPayoutJobSummary> {
  const summary = newPayoutJobSummary();

  // Ensure completion first — see completeFinishedSessions' own comment on
  // why this cron calls it directly rather than trusting the sweep cron ran
  // first today.
  await completeFinishedSessions();

  const supabase = createServiceRoleClient();
  const { data: created, error: syncError } = await supabase.rpc("sync_mentor_payout_rows");
  if (syncError) {
    console.error(`[mentor-payouts] sync_mentor_payout_rows failed: ${syncError.message}`);
    summary.ok = false;
  } else {
    summary.rowsCreated = created ?? 0;
  }

  /*
   * The work list: sessions whose hold window has passed and have never
   * succeeded, PLUS sessions with an outstanding reference from a previous
   * indeterminate attempt (status is back to 'pending' with
   * pending_transfer_reference set — see attemptPayout's own indeterminate
   * branch) regardless of eligible_at, since those are already past due by
   * construction. 'failed' rows are NOT included here — those wait for an
   * admin's deliberate manual retry (src/lib/admin/mentor-payouts/actions.ts),
   * not an automatic re-attempt, the same distinction renewals.ts draws
   * between "keep retrying automatically" and "needs a human."
   */
  const nowIso = new Date().toISOString();
  const { data: due, error: dueError } = await supabase
    .from("mentor_payouts")
    .select("id")
    .eq("status", "pending")
    .or(`eligible_at.lte.${nowIso},pending_transfer_reference.not.is.null`);

  if (dueError) {
    console.error(`[mentor-payouts] work-list query failed: ${dueError.message}`);
    summary.ok = false;
    return summary;
  }

  for (const row of due ?? []) {
    summary.attempted += 1;
    try {
      recordOutcomeInSummary(summary, row.id, await attemptPayout(row.id));
    } catch (err) {
      summary.ok = false;
      summary.errors.push({ payoutId: row.id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}

export type PayoutAttemptOutcome =
  | { outcome: "not_eligible" }
  /** A row stuck at `processing` with no reference on record. Never claimed, never sent. A person decides. */
  | { outcome: "needs_review" }
  /** The reference could not be saved before the transfer, so NO transfer was made. Safe to try again. */
  | { outcome: "reference_unsaved" }
  | { outcome: "paid" }
  /** Paystack says the transfer succeeded and the payout row could not be updated to match. The row keeps its reference, so a later check settles it without a second transfer. */
  | { outcome: "paid_unrecorded"; reference: string; transferCode: string }
  | { outcome: "indeterminate" }
  | { outcome: "indeterminate_unrecorded"; reference: string }
  | { outcome: "failed"; reason: string }
  | { outcome: "failure_unrecorded"; reason: string };

type Db = ReturnType<typeof createServiceRoleClient>;
type PayoutUpdate = Database["public"]["Tables"]["mentor_payouts"]["Update"];

interface Claim {
  id: string;
  session_id: string;
  mentor_id: string;
  amount_ngn: number;
  pending_transfer_reference: string | null;
  attempt_count: number;
}

/**
 * A row at `processing` with no reference, last touched longer ago than this, is treated as stuck: its first transfer may already have gone out and nothing on the row says so.
 * Deliberately SHORTER than the 15 minutes claim_mentor_payout (0149) waits before it lets a processing row be reclaimed, so the SQL can never reclaim a row this check has not already
 * refused. A shorter wait than the SQL's only makes the refusal earlier; an attempt that is genuinely still running (Paystack's own timeout is 15 seconds) is far younger than this.
 */
const STUCK_WITHOUT_REFERENCE_MS = 10 * 60_000;

const newTransferReference = () => `mentor_payout_${randomUUID()}`;

/**
 * The atomic unit of work: claim one payout row, resolve it, act exactly
 * once. Callable by the batch job above AND by an admin's manual retry — the
 * claim step is what makes calling it from two places at once safe, per this
 * file's own header.
 *
 * ── THE ROW IS READ ONCE BEFORE THE CLAIM, to refuse the one row that must never be sent ──
 * A row at `processing` with no `pending_transfer_reference` that has been there for a while is either one whose crash came before anything was sent, or one from before
 * the reference was saved ahead of the transfer, whose transfer may have gone out. Nothing on the row says which, and a reclaim would mint a NEW reference and transfer again.
 * So it is never claimed and never sent: `needs_review`, and a person looks at Paystack. This read is a refusal, not a gate: the money gate stays the one atomic claim below,
 * and the refusal can only make the system more cautious.
 */
export async function attemptPayout(payoutId: string): Promise<PayoutAttemptOutcome> {
  const supabase = createServiceRoleClient();

  const { data: before, error: beforeError } = await supabase
    .from("mentor_payouts")
    .select("status, pending_transfer_reference, last_attempted_at")
    .eq("id", payoutId)
    .maybeSingle();
  if (beforeError) throw new Error(`mentor_payouts read before the claim failed: ${beforeError.message}`);
  if (
    before &&
    before.status === "processing" &&
    before.pending_transfer_reference === null &&
    (before.last_attempted_at === null || Date.now() - Date.parse(before.last_attempted_at) > STUCK_WITHOUT_REFERENCE_MS)
  ) {
    console.error(
      `[mentor-payouts] NEEDS REVIEW payout=${payoutId}: stuck at processing with no Paystack reference on record (last attempt ${before.last_attempted_at ?? "never"}). ` +
        `Not claimed, nothing sent. Check Paystack's dashboard for this mentor and amount, then record the result by hand.`,
    );
    return { outcome: "needs_review" };
  }

  const { data: claimedRows, error: claimError } = await supabase.rpc("claim_mentor_payout", {
    p_payout_id: payoutId,
  });
  if (claimError) throw new Error(`claim_mentor_payout failed: ${claimError.message}`);
  const claim = claimedRows?.[0];
  if (!claim) return { outcome: "not_eligible" };

  // Resolve the mentor's payout configuration and current standing — a
  // suspended/rejected mentor is the deliberate hold lever (0149's own
  // header: reviews are informational, suspension is the real clawback).
  const { data: mentor } = await supabase
    .from("mentor_profiles")
    .select("status, payout_recipient_code")
    .eq("user_id", claim.mentor_id)
    .maybeSingle();

  if (!mentor || mentor.status !== "approved") {
    return recordFailure(supabase, claim, "Mentor is not currently approved — payout withheld pending review.");
  }
  if (!mentor.payout_recipient_code) {
    return recordFailure(
      supabase,
      claim,
      "No verified payout bank details on file for this mentor yet. Retry once they add them.",
    );
  }

  return resolveOrInitiate(supabase, claim, mentor.payout_recipient_code);
}

/* ── Checked writes ────────────────────────────────────────────────────────────
 * supabase-js does not throw on a database error and does not complain when an update matches no row: it RESOLVES. Every write below is therefore
 *   - fenced: `WHERE id AND status = 'processing' AND attempt_count = <the claim's>`, so a stale attempt cannot write over a newer claim's row;
 *   - counted: `.select("id")`, and exactly one row must come back;
 *   - retried ONCE when the database returned an error (a retry cannot change a 0-row answer, so that is not retried).
 * A caller that gets anything but `written` must not report success.
 */
type WriteResult = { kind: "written" } | { kind: "no_row" } | { kind: "error"; message: string };

async function fencedUpdate(
  supabase: Db,
  claim: Pick<Claim, "id" | "attempt_count">,
  values: PayoutUpdate,
  replaces?: { value: string | null },
): Promise<WriteResult> {
  let message = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let query = supabase
      .from("mentor_payouts")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", claim.id)
      .eq("status", "processing")
      .eq("attempt_count", claim.attempt_count);
    if (replaces) {
      query = replaces.value === null ? query.is("pending_transfer_reference", null) : query.eq("pending_transfer_reference", replaces.value);
    }
    const { data, error } = await query.select("id");
    if (!error) return data?.length === 1 ? { kind: "written" } : { kind: "no_row" };
    message = error.message;
  }
  return { kind: "error", message };
}

async function readPayoutState(supabase: Db, payoutId: string) {
  const { data } = await supabase
    .from("mentor_payouts")
    .select("status, paystack_transfer_code, failure_reason")
    .eq("id", payoutId)
    .maybeSingle();
  return data ?? null;
}

/** One line, error level, everything needed to find and settle the payout by hand. */
function logUnrecorded(
  kind: "paid" | "failure" | "indeterminate",
  claim: Pick<Claim, "id" | "attempt_count">,
  details: { reference?: string | null; transferCode?: string | null; intendedStatus: string; result: WriteResult },
) {
  const cause = details.result.kind === "error" ? `database error: ${details.result.message}` : "no row matched (the row is not this attempt's any more)";
  console.error(
    `[mentor-payouts] UNRECORDED ${kind} payout=${claim.id} reference=${details.reference ?? "none"} transfer_code=${details.transferCode ?? "none"} ` +
      `intended_status=${details.intendedStatus} attempt=${claim.attempt_count} cause=${cause}`,
  );
}

/** What a stored reference means at Paystack. Only an unambiguous answer lets anything be acted on. */
type StoredReferenceVerdict =
  | { kind: "success"; transferCode: string }
  | { kind: "unfinished" }
  | { kind: "affirmed_failed" }
  | { kind: "unknown" }
  | { kind: "indeterminate" };

/**
 * `unknown` ("Paystack never created this transfer") is HTTP 404 from the verify call and nothing else. Paystack's client throws a decline for EVERY non-5xx refusal, so a 400, 401,
 * 403 or 429 is also a "decline"; none of those says anything about the reference, and treating one as "no such transfer" is how a rate limit would start a second transfer.
 * Only `failed` and `reversed` are an affirmed non-success; any other status (pending, otp, or one nobody has seen) is unfinished.
 */
async function checkStoredReference(reference: string): Promise<StoredReferenceVerdict> {
  let verified;
  try {
    verified = await verifyTransfer(reference);
  } catch (err) {
    if (isDecline(err) && err.status === 404) return { kind: "unknown" };
    return { kind: "indeterminate" };
  }
  if (verified.status === "success") return { kind: "success", transferCode: verified.transfer_code };
  if (verified.status === "failed" || verified.status === "reversed") return { kind: "affirmed_failed" };
  return { kind: "unfinished" };
}

/** Saves the reference on the row BEFORE any transfer is requested. False means it is NOT saved, and then nothing may be sent. */
async function saveReferenceFirst(supabase: Db, claim: Claim, reference: string, replaces: string | null): Promise<boolean> {
  const result = await fencedUpdate(supabase, claim, { pending_transfer_reference: reference }, { value: replaces });
  if (result.kind === "written") return true;
  console.error(
    `[mentor-payouts] REFERENCE NOT SAVED payout=${claim.id} reference=${reference} attempt=${claim.attempt_count} ` +
      `cause=${result.kind === "error" ? `database error: ${result.message}` : "no row matched"}. No transfer was requested.`,
  );
  return false;
}

/** No money has moved. Put the row back in the queue; if even that fails it stays processing with no reference, which attemptPayout refuses to send. */
async function referenceUnsaved(supabase: Db, claim: Claim): Promise<PayoutAttemptOutcome> {
  const back = await fencedUpdate(supabase, claim, { status: "pending" });
  if (back.kind !== "written") {
    console.error(`[mentor-payouts] payout=${claim.id} could not be put back to pending after its reference failed to save; it stays at processing with no reference and needs a person.`);
  }
  return { outcome: "reference_unsaved" };
}

async function resolveOrInitiate(supabase: Db, claim: Claim, recipientCode: string): Promise<PayoutAttemptOutcome> {
  /*
   * A previous attempt left a reference on the row. Settle THAT before doing
   * anything else — exactly renewals.ts's chargeOne shape: charging (here,
   * transferring) again without first learning what happened to the last
   * attempt is how a network blip becomes a double payout.
   */
  const stored = claim.pending_transfer_reference;
  let reference: string;

  if (stored) {
    const verdict = await checkStoredReference(stored);
    if (verdict.kind === "success") return markPaid(supabase, claim, stored, verdict.transferCode);
    if (verdict.kind === "unfinished" || verdict.kind === "indeterminate") return recordIndeterminate(supabase, claim, stored);
    if (verdict.kind === "unknown") {
      // Paystack never created it (the attempt died before the request, or the request never arrived): ask again with the SAME reference.
      reference = stored;
    } else {
      // Paystack affirms it failed or was reversed: that reference is spent. A new one replaces it on the row before anything is sent.
      reference = newTransferReference();
      if (!(await saveReferenceFirst(supabase, claim, reference, stored))) return referenceUnsaved(supabase, claim);
    }
  } else {
    reference = newTransferReference();
    if (!(await saveReferenceFirst(supabase, claim, reference, null))) return referenceUnsaved(supabase, claim);
  }

  let result;
  try {
    result = await initiateTransfer({
      amountNgn: claim.amount_ngn,
      recipientCode,
      reference,
      reason: "Talentrah mentorship session payout",
    });
  } catch (err) {
    if (!isDecline(err)) {
      // Paystack never answered — genuinely unknown whether the transfer
      // was created. The reference is already on the row, so the next run resolves it first.
      return recordIndeterminate(supabase, claim, reference);
    }
    if (reference === stored) {
      // A REUSED reference was refused. Paystack may be saying "that transfer exists" rather than "no": ask once before calling it a failure.
      const again = await checkStoredReference(reference);
      if (again.kind === "success") return markPaid(supabase, claim, reference, again.transferCode);
      if (again.kind === "unfinished" || again.kind === "indeterminate") return recordIndeterminate(supabase, claim, reference);
    }
    return recordFailure(supabase, claim, `Paystack declined the transfer: ${err.message}`, reference);
  }

  if (result.status === "success") {
    return markPaid(supabase, claim, reference, result.transfer_code);
  }
  if (result.status === "pending" || result.status === "otp") {
    // Accepted but not resolved — commonly an OTP-approval step this cron
    // cannot complete non-interactively. Recorded plainly so an admin knows
    // to check Paystack's own dashboard (or request "Disable OTP" from
    // Paystack support for balance transfers) rather than assume a bug.
    return recordIndeterminate(supabase, claim, reference, result.transfer_code);
  }

  return recordFailure(supabase, claim, `Paystack transfer ended in status "${result.status}".`, reference);
}

async function markPaid(supabase: Db, claim: Claim, reference: string, transferCode: string): Promise<PayoutAttemptOutcome> {
  const result = await fencedUpdate(supabase, claim, {
    status: "paid",
    paid_at: new Date().toISOString(),
    paystack_transfer_code: transferCode,
    pending_transfer_reference: null,
    failure_reason: null,
  });
  if (result.kind === "written") return { outcome: "paid" };
  if (result.kind === "no_row") {
    // Another caller may already have recorded this very payment.
    const now = await readPayoutState(supabase, claim.id);
    if (now?.status === "paid" && now.paystack_transfer_code === transferCode) return { outcome: "paid" };
  }
  logUnrecorded("paid", claim, { reference, transferCode, intendedStatus: "paid", result });
  return { outcome: "paid_unrecorded", reference, transferCode };
}

async function recordFailure(supabase: Db, claim: Claim, reason: string, reference?: string): Promise<PayoutAttemptOutcome> {
  const result = await fencedUpdate(supabase, claim, {
    status: "failed",
    failure_reason: reason,
    pending_transfer_reference: null,
  });
  if (result.kind === "written") return { outcome: "failed", reason };
  if (result.kind === "no_row") {
    const now = await readPayoutState(supabase, claim.id);
    if (now?.status === "failed" && now.failure_reason === reason) return { outcome: "failed", reason };
  }
  logUnrecorded("failure", claim, { reference: reference ?? claim.pending_transfer_reference, intendedStatus: "failed", result });
  return { outcome: "failure_unrecorded", reason };
}

/**
 * Records an attempt Paystack never resolved. Reverts to `pending` (NOT
 * `failed`) so the next cron tick's work-list query picks it straight back
 * up via `pending_transfer_reference is not null` — same "leave
 * next_renewal_date intact, that IS the recovery mechanism" reasoning
 * renewals.ts's own recordIndeterminate uses for Passes.
 *
 * Past MAX_INDETERMINATE_PAYOUT_ATTEMPTS this moves to `failed` instead —
 * needs manual reconciliation — but the reference is deliberately KEPT even
 * then, exactly renewals.ts's own reasoning: it is the only thread back to
 * money whose fate is still genuinely unknown.
 *
 * The reference was saved BEFORE the transfer was requested, so a write here that fails loses nothing: the row stays at `processing` WITH its
 * reference, and the first check after 15 minutes settles it through the verify call. The failure is reported as unrecorded, never as recorded.
 */
async function recordIndeterminate(supabase: Db, claim: Claim, reference: string, transferCode?: string): Promise<PayoutAttemptOutcome> {
  if (claim.attempt_count >= MAX_INDETERMINATE_PAYOUT_ATTEMPTS) {
    const reason = "max indeterminate attempts reached";
    const result = await fencedUpdate(supabase, claim, {
      status: "failed",
      failure_reason:
        `NEEDS RECONCILIATION: ${claim.attempt_count} unresolved attempts — Paystack never confirmed ` +
        `an outcome for reference ${reference}. The transfer may have gone through. Check Paystack's ` +
        `dashboard for this reference before retrying.`,
      // Deliberately NOT cleared — see this function's own header.
      pending_transfer_reference: reference,
      paystack_transfer_code: transferCode ?? undefined,
    });
    if (result.kind === "written") return { outcome: "failed", reason };
    if (result.kind === "no_row") {
      const now = await readPayoutState(supabase, claim.id);
      if (now?.status === "failed" && now.failure_reason?.startsWith("NEEDS RECONCILIATION")) return { outcome: "failed", reason };
    }
    logUnrecorded("failure", claim, { reference, transferCode, intendedStatus: "failed", result });
    return { outcome: "failure_unrecorded", reason };
  }

  const result = await fencedUpdate(supabase, claim, {
    status: "pending",
    pending_transfer_reference: reference,
    paystack_transfer_code: transferCode ?? undefined,
    failure_reason: `Outcome unknown (attempt ${claim.attempt_count}/${MAX_INDETERMINATE_PAYOUT_ATTEMPTS}) — will retry.`,
  });
  if (result.kind === "written") return { outcome: "indeterminate" };
  if (result.kind === "no_row") {
    const now = await readPayoutState(supabase, claim.id);
    if (now?.status === "pending") return { outcome: "indeterminate" };
  }
  logUnrecorded("indeterminate", claim, { reference, transferCode, intendedStatus: "pending", result });
  return { outcome: "indeterminate_unrecorded", reference };
}
