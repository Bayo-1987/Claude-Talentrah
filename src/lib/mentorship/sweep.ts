import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { refundTransaction, isDecline } from "@/lib/paystack/client";

/**
 * The no-show / cancellation policy (0133's own header spells out the "why
 * 24 hours"): a mentor who has not confirmed by 24 hours before the
 * scheduled start is auto-cancelled, and a paid session is refunded
 * automatically. Enforced here by a cron sweep, same shape as
 * `runPassRenewalJob` — a scheduled state check is the only mechanism, so a
 * cron that silently stops firing means no-show cancellations never happen.
 */
const CONFIRMATION_DEADLINE_HOURS = 24;

export interface MentorshipSweepSummary {
  /** False only if the work-list query itself failed — see recordQueryFailure below. */
  ok: boolean;
  considered: number;
  cancelled: number;
  refunded: number;
  /** A session was cancelled but its refund request failed — needs manual reconciliation, per refundTransaction's own documented gap. */
  refundFailed: number;
  errors: Array<{ sessionId: string; message: string }>;
}

/**
 * Confirmed sessions whose scheduled_end has passed become `completed` — the
 * one session-lifecycle transition 0133 never actually built (its own header
 * describes the state machine ending at `confirmed` with nothing moving it
 * further). Added here rather than as a third cron, for two reasons: this
 * file already owns time-based `mentorship_sessions.status` transitions, and
 * mentor payouts (0149, src/lib/mentorship/payouts.ts) depend on `completed`
 * existing — calling this from BOTH runMentorshipSweep and
 * runMentorPayoutJob removes any ordering dependency between the two crons
 * (each ensures completion for itself rather than trusting the other ran
 * first today).
 *
 * A conditional UPDATE, same idempotent shape as everything else in this
 * file: running it any number of times, from any number of concurrent
 * callers, moves each eligible session to `completed` exactly once — a
 * second call simply matches zero rows for one already moved.
 */
export async function completeFinishedSessions(): Promise<number> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("mentorship_sessions")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("status", "confirmed")
    .lte("scheduled_end", new Date().toISOString())
    .select("id");

  if (error) {
    console.error(`[mentorship-sweep] completeFinishedSessions failed: ${error.message}`);
    return 0;
  }
  return data?.length ?? 0;
}

export async function runMentorshipSweep(): Promise<MentorshipSweepSummary> {
  const summary: MentorshipSweepSummary = {
    ok: true,
    considered: 0,
    cancelled: 0,
    refunded: 0,
    refundFailed: 0,
    errors: [],
  };

  await completeFinishedSessions();

  const supabase = createServiceRoleClient();
  const deadline = new Date(Date.now() + CONFIRMATION_DEADLINE_HOURS * 60 * 60 * 1000).toISOString();

  const { data: overdue, error } = await supabase
    .from("mentorship_sessions")
    .select("id, price_ngn")
    .eq("status", "awaiting_confirmation")
    .lte("scheduled_start", deadline);

  if (error) {
    console.error(`[mentorship-sweep] work-list query failed: ${error.message}`);
    summary.ok = false;
    return summary;
  }

  summary.considered = overdue?.length ?? 0;

  for (const session of overdue ?? []) {
    try {
      await processOverdueSession(supabase, session.id, session.price_ngn, summary);
    } catch (err) {
      summary.ok = false;
      summary.errors.push({
        sessionId: session.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

async function processOverdueSession(
  supabase: ReturnType<typeof createServiceRoleClient>,
  sessionId: string,
  priceNgn: number,
  summary: MentorshipSweepSummary,
) {
  /*
   * Conditional UPDATE, same "check and act in one statement" shape CLAUDE.md
   * requires for anything gating on a compared value — the WHERE clause is
   * the guard against a mentor who confirmed in the gap between the
   * work-list query above and this write: if they did, `status` is no
   * longer `awaiting_confirmation`, zero rows match, and this session is
   * correctly skipped rather than cancelled out from under a just-confirmed
   * booking.
   */
  const { data: updated } = await supabase
    .from("mentorship_sessions")
    .update({ status: "cancelled_mentor_no_confirm", updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("status", "awaiting_confirmation")
    .select("id")
    .maybeSingle();

  if (!updated) return;
  summary.cancelled += 1;

  if (priceNgn === 0) return;

  const { data: transaction } = await supabase
    .from("payment_transactions")
    .select("paystack_reference")
    .eq("product_type", "mentor_session")
    .eq("product_id", sessionId)
    .eq("status", "success")
    .maybeSingle();

  if (!transaction?.paystack_reference) {
    // A paid session with no successful transaction on record would be a
    // real inconsistency (book_mentor_session only lands a paid session in
    // awaiting_confirmation via fulfillPayment, which requires a successful
    // charge first) — log it loudly rather than silently skip the refund.
    console.error(`[mentorship-sweep] session ${sessionId} has price_ngn=${priceNgn} but no successful transaction found`);
    summary.refundFailed += 1;
    return;
  }

  try {
    await refundTransaction(transaction.paystack_reference);
    // A second conditional UPDATE, guarded the same way — this session's
    // cancellation is the precondition for calling it refunded, so a
    // concurrent second sweep run (or a retry after a crash between these
    // two writes) cannot double-refund: the first UPDATE above already
    // moved status off `awaiting_confirmation`, so a re-run's own first
    // UPDATE matches nothing and this whole function returns early.
    await supabase
      .from("mentorship_sessions")
      .update({ status: "refunded", updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("status", "cancelled_mentor_no_confirm");
    summary.refunded += 1;
  } catch (err) {
    // isDecline vs. unavailable both land here identically: either way the
    // refund did not confirm, and per refundTransaction's own documented
    // gap this needs a human to reconcile against Paystack's dashboard.
    // Left in `cancelled_mentor_no_confirm`, not `refunded` — an unconfirmed
    // refund is not something to claim.
    console.error(
      `[mentorship-sweep] refund failed for session ${sessionId}: ${
        err instanceof Error ? err.message : String(err)
      }${isDecline(err) ? " (declined)" : ""}`,
    );
    summary.refundFailed += 1;
  }
}
