import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PaystackDeclineError, PaystackUnavailableError, verifyTransaction, type VerifyResult } from "@/lib/paystack/client";
import { fulfillPayment } from "@/lib/billing/fulfill";
import { sendAdminAlert } from "@/lib/admin/alert-email";

/**
 * The daily check of stale pending payments with Paystack (Plan B).
 *
 * WHY. A payment row still `pending` after a day is one of two things: a checkout the buyer abandoned, or a real charge whose webhook never arrived (so someone paid and did not get what
 * they bought). Nothing told the two apart. This asks Paystack, and acts on exactly one answer.
 *
 * THE RULE THAT MATTERS. Ask Paystack FIRST (`verifyTransaction`, read-only), and call `fulfillPayment` ONLY when the answer is `success`. fulfillPayment is the one place a payment becomes
 * real, and on a terminal answer (`failed`, `reversed`) it writes `status = 'failed'` for good — a buyer who then pays the old link would land on a row that is no longer pending and be granted
 * nothing. (Since #870 it leaves an `abandoned` or still-open checkout pending; this file does not lean on that, so a later change to fulfillPayment cannot turn a daily sweep into a closer.)
 * For every answer but `success` this only RECORDS what it found (migration 0247: reconcile_checked_at / reconcile_result / reconcile_attempts) and never touches `status`. The webhook can
 * still fulfil that row later; a test holds that.
 *
 * NO MONEY LOGIC OF ITS OWN. The grant, the amount/currency check, the deleted-payer path and the receipt are all fulfillPayment's, which is atomic and idempotent (0159). That is also why the
 * buyer's receipt goes out exactly once: it is sent only by the call that claimed the row, and a webhook that wins the race makes this check's call `already_processed`.
 *
 * WHICH ROWS. `pending`, older than 24 h, with a Paystack reference, and not a renewal charge (renewals have their own indeterminate-charge flow, 0043). Then:
 *   - never checked: checked once, whatever its age (so the old stale rows get their look);
 *   - already has a finding: checked again daily, but only for 7 days after the row was created (the webhook still catches a late payment after that);
 *   - last check ended in `error`: retried each day until it has failed 5 times, whatever its age.
 * "Daily" is a 20-hour gap, not 24: a cron that fires a few minutes earlier than yesterday would otherwise skip every row for another day. Never-checked rows first, then the longest-unchecked, at most 25 a run, a short pause between
 * Paystack calls, and a time budget: Paystack's own rate limits were not verifiable from here, so the call rate is kept far below any plausible limit and a 429 is just an `error` for tomorrow.
 *
 * "NOT FOUND" is Paystack answering 404 to verify (it does not know the reference). That reading of Paystack's verify error is not something the docs could be fetched to confirm from here;
 * any other refusal (a bad key, a bad request) is recorded as an `error`, never as a finding about the payment.
 */

export const RECONCILE_MIN_AGE_HOURS = 24;
export const RECONCILE_RECHECK_GAP_HOURS = 20;
export const RECONCILE_RECHECK_WINDOW_DAYS = 7;
export const RECONCILE_MAX_ERROR_ATTEMPTS = 5;
export const RECONCILE_BATCH_LIMIT = 25;
export const RECONCILE_PAUSE_MS = 250;
export const RECONCILE_DEADLINE_MS = 40_000;

/** The closed list migration 0247's CHECK allows. tests/billing/reconcile-result-words.test.ts keeps this and the migration equal. */
export const RECONCILE_RESULTS = [
  "error",
  "fulfilled_by_check",
  "paystack_abandoned",
  "paystack_failed",
  "paystack_not_found",
  "paystack_reversed",
  "paystack_unsettled",
] as const;
export type ReconcileResult = (typeof RECONCILE_RESULTS)[number];

type Db = SupabaseClient<Database>;

export interface ReconcileCandidate {
  id: string;
  paystack_reference: string;
  user_id: string | null;
  amount: number;
  product_type: string;
  created_at: string;
  reconcile_checked_at: string | null;
  reconcile_result: string | null;
  reconcile_attempts: number;
}

const CANDIDATE_COLUMNS = "id, paystack_reference, user_id, amount, product_type, created_at, reconcile_checked_at, reconcile_result, reconcile_attempts";
const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

/** The stale pending rows worth asking Paystack about, oldest first. Throws on a database error (the caller reports a failed query, not an empty list). */
export async function selectReconcileCandidates(supabase: Db, now: Date, limit: number): Promise<ReconcileCandidate[]> {
  if (limit <= 0) return [];
  const gap = hoursAgo(now, RECONCILE_RECHECK_GAP_HOURS);
  const window = hoursAgo(now, RECONCILE_RECHECK_WINDOW_DAYS * 24);
  const { data, error } = await supabase
    .from("payment_transactions")
    .select(CANDIDATE_COLUMNS)
    .eq("status", "pending")
    .not("paystack_reference", "is", null)
    .is("renewal_for_pass_id", null)
    .lt("created_at", hoursAgo(now, RECONCILE_MIN_AGE_HOURS))
    .lt("reconcile_attempts", RECONCILE_MAX_ERROR_ATTEMPTS)
    .or(`reconcile_checked_at.is.null,and(reconcile_checked_at.lt.${gap},created_at.gt.${window}),and(reconcile_result.eq.error,reconcile_checked_at.lt.${gap})`)
    // Never-checked rows first, then the longest-unchecked: oldest-first alone, with the 7-day rechecks, could keep a backlog of rechecks ahead of brand-new stale rows beyond the daily limit.
    .order("reconcile_checked_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as ReconcileCandidate[];
}

export type CheckOutcome = ReconcileResult | "not_pending" | "not_eligible" | "not_found";

interface Found {
  reference: string;
  amountNgn: number;
  productType: string;
}
interface Tally {
  fulfilled: Found[];
  /** A charge Paystack confirmed that fulfilment then refused (amount/currency mismatch, a second answer that disagreed, a database fault): money moved and nothing was granted. */
  problems: Array<Found & { why: string }>;
}

/** Record a finding. `onlyIfPending` stops a late finding being written onto a row that has meanwhile been fulfilled. A failed write is logged, never thrown: the finding is bookkeeping. */
async function record(supabase: Db, tx: ReconcileCandidate, result: ReconcileResult, o: { onlyIfPending: boolean; countError?: boolean }): Promise<void> {
  const patch: Database["public"]["Tables"]["payment_transactions"]["Update"] = { reconcile_result: result, reconcile_checked_at: new Date().toISOString() };
  if (o.countError) patch.reconcile_attempts = tx.reconcile_attempts + 1;
  let q = supabase.from("payment_transactions").update(patch).eq("id", tx.id);
  if (o.onlyIfPending) q = q.eq("status", "pending");
  if (o.countError) q = q.eq("reconcile_attempts", tx.reconcile_attempts);
  const { error } = await q;
  if (error) console.error(`[payment-reconcile] could not record "${result}" for ${tx.paystack_reference}: ${error.message}`);
}

/** An answer (or a failure to get one) from Paystack, as opposed to a fault of ours. */
function isPaystackError(err: unknown): boolean {
  return err instanceof PaystackUnavailableError || err instanceof PaystackDeclineError;
}

function describe(tx: ReconcileCandidate): Found {
  return { reference: tx.paystack_reference, amountNgn: tx.amount, productType: tx.product_type };
}

/** Ask Paystack, then act on exactly one answer. Never throws. */
async function checkRow(supabase: Db, tx: ReconcileCandidate, tally: Tally): Promise<CheckOutcome> {
  const reference = tx.paystack_reference;
  let verified: VerifyResult;
  try {
    verified = await verifyTransaction(reference);
  } catch (err) {
    if (err instanceof PaystackDeclineError && err.status === 404) {
      await record(supabase, tx, "paystack_not_found", { onlyIfPending: true });
      return "paystack_not_found";
    }
    console.warn(`[payment-reconcile] could not ask Paystack about ${reference}: ${err instanceof Error ? err.message : String(err)}`);
    await record(supabase, tx, "error", { onlyIfPending: true, countError: true });
    return "error";
  }

  if (verified.status !== "success") {
    const word: ReconcileResult =
      verified.status === "abandoned" ? "paystack_abandoned" : verified.status === "failed" ? "paystack_failed" : verified.status === "reversed" ? "paystack_reversed" : "paystack_unsettled";
    await record(supabase, tx, word, { onlyIfPending: true });
    return word;
  }

  // Paystack says the money moved. The existing, atomic, idempotent path does everything from here.
  let fulfilled: Awaited<ReturnType<typeof fulfillPayment>>;
  try {
    fulfilled = await fulfillPayment(reference);
  } catch (err) {
    console.error(`[payment-reconcile] fulfilment of ${reference} threw: ${err instanceof Error ? err.message : String(err)}`);
    /*
     * fulfillPayment asks Paystack again by itself, so a throw is usually Paystack blinking a second time (retry tomorrow, quietly). The loud "someone has paid and has nothing" email goes out
     * only for a failure that is NOT Paystack's (a database fault in the grant is not going to fix itself), or when this was the last attempt and nobody else will look.
     */
    const lastAttempt = tx.reconcile_attempts + 1 >= RECONCILE_MAX_ERROR_ATTEMPTS;
    if (!isPaystackError(err) || lastAttempt) {
      tally.problems.push({ ...describe(tx), why: isPaystackError(err) ? `Paystack confirmed the charge but could not be asked a second time, ${RECONCILE_MAX_ERROR_ATTEMPTS} days running; it will not be retried by itself` : "Paystack confirmed the charge but granting it raised a database error" });
    }
    await record(supabase, tx, "error", { onlyIfPending: true, countError: true });
    return "error";
  }
  switch (fulfilled.status) {
    case "success":
      await record(supabase, tx, "fulfilled_by_check", { onlyIfPending: false });
      tally.fulfilled.push(describe(tx));
      return "fulfilled_by_check";
    case "already_processed":
      // The webhook (or the buyer's callback) got there between the query and now. Not ours to claim.
      return "not_pending";
    case "processing":
      await record(supabase, tx, "paystack_unsettled", { onlyIfPending: true });
      return "paystack_unsettled";
    case "failed":
      tally.problems.push({ ...describe(tx), why: "Paystack confirmed the charge, but fulfilment refused it and closed the row as failed: either the amount or currency did not match the order, or Paystack's second answer was failed or reversed. Nothing was granted" });
      await record(supabase, tx, "error", { onlyIfPending: false });
      return "error";
    case "needs_refund":
      // fulfillPayment has already alerted the operator for this one.
      await record(supabase, tx, "error", { onlyIfPending: false });
      return "error";
    case "not_found":
    default:
      await record(supabase, tx, "error", { onlyIfPending: false });
      return "error";
  }
}

async function alertOperator(tally: Tally, trigger: string): Promise<void> {
  if (tally.fulfilled.length === 0 && tally.problems.length === 0) return;
  const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;
  const lines: string[] = [];
  if (tally.fulfilled.length > 0) {
    lines.push(
      `The Paystack check (${trigger}) found ${tally.fulfilled.length} payment${tally.fulfilled.length === 1 ? "" : "s"} that Paystack had confirmed but Talentrah had not fulfilled. They are fulfilled now and the buyers have their receipts.`,
      `That means the webhook did not deliver for them: please check the Paystack webhook (delivery log and URL) and the Vercel function logs.`,
      ``,
      ...tally.fulfilled.map((f) => `  ${f.reference}   ${naira(f.amountNgn)}   ${f.productType}`),
    );
  }
  if (tally.problems.length > 0) {
    if (lines.length) lines.push(``);
    lines.push(`Paystack confirmed ${tally.problems.length} charge${tally.problems.length === 1 ? "" : "s"} that could NOT be fulfilled. Someone has paid and has nothing; please look at each:`, ``, ...tally.problems.map((f) => `  ${f.reference}   ${naira(f.amountNgn)}   ${f.productType}   ${f.why}`));
  }
  lines.push(``, `The Finance page lists these under "Fulfilled by the check".`);
  await sendAdminAlert({
    subject: tally.problems.length > 0 ? `Payment problem found by the Paystack check (${tally.fulfilled.length + tally.problems.length})` : `Lost webhook: ${tally.fulfilled.length} payment${tally.fulfilled.length === 1 ? "" : "s"} fulfilled by the Paystack check`,
    text: lines.join("\n"),
  });
}

export interface ReconcileSummary {
  /** False only when the work list could not be read: a run that skipped an unknown number of rows must not look clean. */
  ok: boolean;
  queryError?: string;
  candidates: number;
  /** References this run itself fulfilled. */
  fulfilled: string[];
  /** Confirmed charges that fulfilment refused. */
  problems: string[];
  byResult: Partial<Record<CheckOutcome, number>>;
  stopped: "done" | "deadline";
}

export interface RunOptions {
  now?: Date;
  limit?: number;
  pauseMs?: number;
  deadlineMs?: number;
  supabase?: Db;
}

/** The daily run. Never throws; a failed work-list query comes back as `ok: false`. */
export async function runPaymentReconcile(opts: RunOptions = {}): Promise<ReconcileSummary> {
  const supabase = opts.supabase ?? createServiceRoleClient();
  const started = Date.now();
  const deadlineMs = opts.deadlineMs ?? RECONCILE_DEADLINE_MS;
  const pauseMs = opts.pauseMs ?? RECONCILE_PAUSE_MS;
  const summary: ReconcileSummary = { ok: true, candidates: 0, fulfilled: [], problems: [], byResult: {}, stopped: "done" };
  const tally: Tally = { fulfilled: [], problems: [] };

  let rows: ReconcileCandidate[];
  try {
    rows = await selectReconcileCandidates(supabase, opts.now ?? new Date(), opts.limit ?? RECONCILE_BATCH_LIMIT);
  } catch (err) {
    return { ...summary, ok: false, queryError: err instanceof Error ? err.message : String(err) };
  }
  summary.candidates = rows.length;

  for (let i = 0; i < rows.length; i++) {
    if (Date.now() - started >= deadlineMs) {
      summary.stopped = "deadline";
      break;
    }
    if (i > 0 && pauseMs > 0) await new Promise((r) => setTimeout(r, pauseMs));
    const outcome = await checkRow(supabase, rows[i], tally);
    summary.byResult[outcome] = (summary.byResult[outcome] ?? 0) + 1;
  }

  summary.fulfilled = tally.fulfilled.map((f) => f.reference);
  summary.problems = tally.problems.map((f) => f.reference);
  await alertOperator(tally, "daily run");
  return summary;
}

/**
 * One payment, on demand (the Finance page's "Check with Paystack"). Unlike the daily run it ignores the 20-hour gap, the 7-day window and the 5-error limit: a person asked. It still only
 * acts on a pending, non-renewal row, and asks Paystack before anything else.
 */
export async function checkPaymentWithPaystack(reference: string, opts: { supabase?: Db } = {}): Promise<{ outcome: CheckOutcome }> {
  const supabase = opts.supabase ?? createServiceRoleClient();
  const { data, error } = await supabase
    .from("payment_transactions")
    .select(`${CANDIDATE_COLUMNS}, status, renewal_for_pass_id`)
    .eq("paystack_reference", reference)
    .maybeSingle();
  if (error) throw new Error(`could not read the payment: ${error.message}`);
  if (!data) return { outcome: "not_found" };
  if (data.status !== "pending") return { outcome: "not_pending" };
  if (data.renewal_for_pass_id) return { outcome: "not_eligible" };
  const tally: Tally = { fulfilled: [], problems: [] };
  const outcome = await checkRow(supabase, data as unknown as ReconcileCandidate, tally);
  await alertOperator(tally, "checked from the Finance page");
  return { outcome };
}
