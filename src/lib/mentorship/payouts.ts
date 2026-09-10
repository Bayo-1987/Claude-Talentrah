import "server-only";
import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { initiateTransfer, verifyTransfer, isDecline } from "@/lib/paystack/client";
import { completeFinishedSessions } from "@/lib/mentorship/sweep";

/**
 * Mentor payouts — Mentorship v2, part 1 (0139). Read 0139's own migration
 * header before touching this file: it records the hold-window and
 * bad-review-clawback decisions this module enforces.
 *
 * ── THE CLAIM-THEN-ACT SHAPE, RESTATED HERE BECAUSE IT IS THE WHOLE POINT ──
 *
 * `attemptPayout` is the one function that ever calls Paystack's Transfer
 * API for a given payout row, and it is safe to call it concurrently, any
 * number of times, from any caller (the cron loop below, or an admin's
 * manual retry in src/lib/admin/mentor-payouts/actions.ts) — because the
 * FIRST thing it does is `claim_mentor_payout` (0139), one atomic
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
 * The 72-hour hold window itself is enforced in SQL, not here —
 * `sync_mentor_payout_rows` (0139) sets `eligible_at` at row-creation time,
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
  errors: Array<{ payoutId: string; message: string }>;
}

/**
 * The batch cron entry point (src/app/api/admin/mentor-payouts/route.ts).
 * BATCH row-selection, PER-SESSION atomic claim+attempt — same shape as
 * runPassRenewalJob and runMentorshipSweep: one work-list query, then a loop
 * where each row's own fate is decided by one atomic statement.
 */
export async function runMentorPayoutJob(): Promise<MentorPayoutJobSummary> {
  const summary: MentorPayoutJobSummary = {
    ok: true,
    rowsCreated: 0,
    attempted: 0,
    paid: 0,
    indeterminate: 0,
    failed: 0,
    errors: [],
  };

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
      const outcome = await attemptPayout(row.id);
      if (outcome.outcome === "paid") summary.paid += 1;
      else if (outcome.outcome === "indeterminate") summary.indeterminate += 1;
      else if (outcome.outcome === "failed") summary.failed += 1;
    } catch (err) {
      summary.ok = false;
      summary.errors.push({ payoutId: row.id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}

export type PayoutAttemptOutcome =
  | { outcome: "not_eligible" }
  | { outcome: "paid" }
  | { outcome: "indeterminate" }
  | { outcome: "failed"; reason: string };

/**
 * The atomic unit of work: claim one payout row, resolve it, act exactly
 * once. Callable by the batch job above AND by an admin's manual retry — the
 * claim step is what makes calling it from two places at once safe, per this
 * file's own header.
 */
export async function attemptPayout(payoutId: string): Promise<PayoutAttemptOutcome> {
  const supabase = createServiceRoleClient();

  const { data: claimedRows, error: claimError } = await supabase.rpc("claim_mentor_payout", {
    p_payout_id: payoutId,
  });
  if (claimError) throw new Error(`claim_mentor_payout failed: ${claimError.message}`);
  const claim = claimedRows?.[0];
  if (!claim) return { outcome: "not_eligible" };

  // Resolve the mentor's payout configuration and current standing — a
  // suspended/rejected mentor is the deliberate hold lever (0139's own
  // header: reviews are informational, suspension is the real clawback).
  const { data: mentor } = await supabase
    .from("mentor_profiles")
    .select("status, payout_recipient_code")
    .eq("user_id", claim.mentor_id)
    .maybeSingle();

  if (!mentor || mentor.status !== "approved") {
    return recordFailure(
      supabase,
      claim.id,
      "Mentor is not currently approved — payout withheld pending review.",
    );
  }
  if (!mentor.payout_recipient_code) {
    return recordFailure(
      supabase,
      claim.id,
      "No verified payout bank details on file for this mentor yet. Retry once they add them.",
    );
  }

  return resolveOrInitiate(supabase, claim, mentor.payout_recipient_code);
}

async function resolveOrInitiate(
  supabase: ReturnType<typeof createServiceRoleClient>,
  claim: {
    id: string;
    session_id: string;
    mentor_id: string;
    amount_ngn: number;
    pending_transfer_reference: string | null;
    attempt_count: number;
  },
  recipientCode: string,
): Promise<PayoutAttemptOutcome> {
  /*
   * A previous attempt left an outcome unknown. Settle THAT before doing
   * anything else — exactly renewals.ts's chargeOne shape: charging (here,
   * transferring) again without first learning what happened to the last
   * attempt is how a network blip becomes a double payout.
   */
  if (claim.pending_transfer_reference) {
    let verified;
    try {
      verified = await verifyTransfer(claim.pending_transfer_reference);
    } catch (err) {
      if (!isDecline(err)) {
        // Paystack never answered about this reference either. Cannot
        // safely conclude anything — back off, stay indeterminate.
        return recordIndeterminate(supabase, claim, claim.pending_transfer_reference);
      }
      // Paystack answered and the verify call itself was refused (e.g. an
      // unrecognised reference) — treat as an affirmed non-success below.
      verified = null;
    }

    if (verified?.status === "success") {
      return markPaid(supabase, claim.id, claim.pending_transfer_reference, verified.transfer_code);
    }
    if (verified?.status === "pending" || verified?.status === "otp") {
      // Still unresolved at Paystack's end.
      return recordIndeterminate(supabase, claim, claim.pending_transfer_reference);
    }
    // Affirmed failed/reversed (or an unresolvable reference) — clear the
    // slot so a fresh reference below owns the retry.
  }

  const reference = `mentor_payout_${randomUUID()}`;
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
      // was created. Keep the reference so the next run resolves it first.
      return recordIndeterminate(supabase, claim, reference);
    }
    return recordFailure(supabase, claim.id, `Paystack declined the transfer: ${err.message}`);
  }

  if (result.status === "success") {
    return markPaid(supabase, claim.id, reference, result.transfer_code);
  }
  if (result.status === "pending" || result.status === "otp") {
    // Accepted but not resolved — commonly an OTP-approval step this cron
    // cannot complete non-interactively. Recorded plainly so an admin knows
    // to check Paystack's own dashboard (or request "Disable OTP" from
    // Paystack support for balance transfers) rather than assume a bug.
    return recordIndeterminate(supabase, claim, reference, result.transfer_code);
  }

  return recordFailure(supabase, claim.id, `Paystack transfer ended in status "${result.status}".`);
}

async function markPaid(
  supabase: ReturnType<typeof createServiceRoleClient>,
  payoutId: string,
  reference: string,
  transferCode: string,
): Promise<PayoutAttemptOutcome> {
  await supabase
    .from("mentor_payouts")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      paystack_transfer_code: transferCode,
      pending_transfer_reference: null,
      failure_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payoutId)
    .eq("status", "processing");
  return { outcome: "paid" };
}

async function recordFailure(
  supabase: ReturnType<typeof createServiceRoleClient>,
  payoutId: string,
  reason: string,
): Promise<PayoutAttemptOutcome> {
  await supabase
    .from("mentor_payouts")
    .update({
      status: "failed",
      failure_reason: reason,
      pending_transfer_reference: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payoutId)
    .eq("status", "processing");
  return { outcome: "failed", reason };
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
 */
async function recordIndeterminate(
  supabase: ReturnType<typeof createServiceRoleClient>,
  claim: { id: string; attempt_count: number },
  reference: string,
  transferCode?: string,
): Promise<PayoutAttemptOutcome> {
  if (claim.attempt_count >= MAX_INDETERMINATE_PAYOUT_ATTEMPTS) {
    await supabase
      .from("mentor_payouts")
      .update({
        status: "failed",
        failure_reason:
          `NEEDS RECONCILIATION: ${claim.attempt_count} unresolved attempts — Paystack never confirmed ` +
          `an outcome for reference ${reference}. The transfer may have gone through. Check Paystack's ` +
          `dashboard for this reference before retrying.`,
        // Deliberately NOT cleared — see this function's own header.
        pending_transfer_reference: reference,
        paystack_transfer_code: transferCode ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", claim.id)
      .eq("status", "processing");
    return { outcome: "failed", reason: "max indeterminate attempts reached" };
  }

  await supabase
    .from("mentor_payouts")
    .update({
      status: "pending",
      pending_transfer_reference: reference,
      paystack_transfer_code: transferCode ?? undefined,
      failure_reason: `Outcome unknown (attempt ${claim.attempt_count}/${MAX_INDETERMINATE_PAYOUT_ATTEMPTS}) — will retry.`,
      updated_at: new Date().toISOString(),
    })
    .eq("id", claim.id)
    .eq("status", "processing");
  return { outcome: "indeterminate" };
}
