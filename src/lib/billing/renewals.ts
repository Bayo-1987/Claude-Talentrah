import "server-only";
import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { chargeAuthorization, verifyTransaction, isDecline } from "@/lib/paystack/client";
import { isTerminalPaystackFailure, isUnrecognisedPaystackStatus } from "@/lib/paystack/status";
import { getResendClient } from "@/lib/resend/client";
import { visibleName } from "@/lib/profile/name";
import { absoluteUrl } from "@/lib/seo/site";
import { emailButton, emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";

/**
 * How many consecutive INDETERMINATE failures a Pass tolerates before it
 * finally lapses.
 *
 * The cron runs daily, so three is roughly three days of grace. Chosen rather
 * than derived: Paystack incidents are typically minutes to hours, so a
 * failure still unresolved after three daily attempts is no longer plausibly
 * transient, and continuing to promise a renewal that never happens is its own
 * dishonesty. A genuine decline does NOT consume an attempt — it lapses
 * immediately, as it always has.
 */
export const MAX_INDETERMINATE_RENEWAL_ATTEMPTS = 3;

/** How far ahead of the actual renewal date to send the reminder. */
const REMINDER_WINDOW_DAYS = 3;

/**
 * How long a claim on a due Pass is honored before another run may reclaim
 * it. Not a permanent lock: a run that crashed between claiming and
 * finishing must not strand the Pass forever. Minutes, not days, because the
 * legitimate retry path (an indeterminate outcome) is expected to wait for
 * "the next daily cron run" anyway (0043) — by then any claim from this run
 * is long stale regardless of what this constant is set to.
 */
const CLAIM_STALENESS_MINUTES = 15;

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The first instant of the next UTC day, in epoch milliseconds. */
function startOfNextUtcDay(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
}

function addDaysDateOnly(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface RenewalJobSummary {
  /**
   * False if any stage failed to even read its work-list. Distinct from
   * per-Pass `errors`: a query failure means an unknown number of Passes
   * were never looked at, so zero counters below do NOT mean "nothing was
   * due". Callers (and the cron monitor) must treat this as a failed run.
   */
  ok: boolean;
  remindersSent: number;
  renewed: number;
  lapsed: number;
  /**
   * Passes whose renewal outcome Paystack never confirmed this run. NOT
   * failures and NOT lapses — they keep auto-renew on and are retried next
   * run. Surfaced separately so a monitor can see an outage building rather
   * than reading zero-lapses as "all well".
   */
  indeterminate: number;
  /** Per-Pass failures — the Pass was found, but processing it failed. */
  errors: Array<{ userPassId: string; message: string }>;
  /** Stage-level failures — the work-list query itself failed. */
  queryErrors: Array<{ stage: "reminders" | "charges"; message: string }>;
}

/**
 * Entry point for the scheduled renewal job (fix-prompt §1). Does two
 * independent things in one pass, same as the spec asks for:
 *  (a) reminder — Passes whose next_renewal_date falls within the reminder
 *      window get a heads-up, once per cycle.
 *  (b) recharge — Passes whose next_renewal_date has arrived get charged
 *      via their stored reusable authorization_code; success extends the
 *      Pass, failure marks it lapsed rather than leaving a stale "will
 *      renew" promise (per §1's explicit failure-path requirement — no
 *      retry/dunning, a single failed attempt is enough to lapse it).
 *
 * Reuses the same pattern as src/lib/jobs/ingest.ts /
 * api/admin/ingest-jobs: a plain function callable from an authenticated
 * admin route, meant to be pointed at by Vercel Cron (or run on demand
 * until then). No new scheduler infrastructure.
 */
export async function runPassRenewalJob(): Promise<RenewalJobSummary> {
  const summary: RenewalJobSummary = {
    ok: true,
    remindersSent: 0,
    renewed: 0,
    lapsed: 0,
    indeterminate: 0,
    errors: [],
    queryErrors: [],
  };

  await sendReminders(summary);
  await chargeDueRenewals(summary);

  return summary;
}

/**
 * A work-list query failed. Without this the job would fall through to
 * `data ?? []`, iterate zero rows, and report a clean run — making a broken
 * query indistinguishable from "nothing was due" to both the cron monitor
 * and anyone reading the response. Loud in the logs, and `ok: false` so the
 * admin route can answer with a non-2xx.
 */
function recordQueryFailure(
  summary: RenewalJobSummary,
  stage: "reminders" | "charges",
  message: string,
) {
  console.error(`[pass-renewal] ${stage} query failed, stage skipped: ${message}`);
  summary.ok = false;
  summary.queryErrors.push({ stage, message });
}

async function sendReminders(summary: RenewalJobSummary) {
  const supabase = createServiceRoleClient();
  const { data: dueSoon, error } = await supabase
    .from("user_passes")
    .select("id, next_renewal_date, profiles!user_passes_user_id_fkey(email, first_name), passes(name, price_ngn)")
    .eq("auto_renew_status", "active")
    // A Pass whose owner's account was deleted (user_id null, 0209) is never reminded and never charged.
    .not("user_id", "is", null)
    .is("renewal_reminder_sent_at", null)
    .lte("next_renewal_date", addDaysDateOnly(REMINDER_WINDOW_DAYS))
    .gte("next_renewal_date", todayDateOnly());

  if (error) {
    recordQueryFailure(summary, "reminders", error.message);
    return;
  }

  for (const row of dueSoon ?? []) {
    try {
      await sendReminderEmail(row);
      await supabase
        .from("user_passes")
        .update({ renewal_reminder_sent_at: new Date().toISOString() })
        .eq("id", row.id);
      summary.remindersSent++;
    } catch (err) {
      summary.errors.push({
        userPassId: row.id,
        message: err instanceof Error ? err.message : "Unknown reminder error",
      });
    }
  }
}

/**
 * Best-effort — this repo has no general notification pipeline yet, just
 * the shared Resend client (src/lib/resend/client.ts) each transactional
 * sender calls directly (corrected send-395: this comment used to say
 * Resend was "only wired to the Contact form", which stopped being true
 * once the digest, mentorship, billing and talent-directory emails were
 * added). Reusing that same client here rather than building new delivery
 * infra, per the fix-prompt's explicit scope note. If RESEND_API_KEY isn't
 * configured, this silently no-ops rather than blocking the recharge step
 * — the billing page's "renews on <date>" copy is the actual guaranteed
 * in-app surface either way.
 */
async function sendReminderEmail(row: {
  id: string;
  next_renewal_date: string | null;
  profiles: { email: string; first_name: string | null } | null;
  passes: { name: string; price_ngn: number } | null;
}) {
  const resend = getResendClient();
  if (!resend || !row.profiles?.email) return;

  const greeting = visibleName(row.profiles.first_name) ? `Hi ${visibleName(row.profiles.first_name)},` : "Hi,";
  const passName = row.passes?.name ?? "Talentrah Pass";
  const priceText = `₦${(row.passes?.price_ngn ?? 0).toLocaleString()}`;
  const billingUrl = absoluteUrl("/billing");
  const body = `Your ${passName} will auto-renew on ${row.next_renewal_date} for ${priceText}, charged to the card on file. You can cancel auto-renewal anytime from your Billing page — this won't affect your current access either way.`;

  await resend.emails.send({
    from: "Talentrah <billing@talentrah.com>",
    to: row.profiles.email,
    subject: `Your ${row.passes?.name ?? "Pass"} renews soon`,
    text: `${greeting}\n\n${body}\n\n— Talentrah`,
    html: renderBrandedEmail({
      bodyHtml: [
        emailParagraph(escEmail(greeting)),
        emailParagraph(escEmail(body)),
        emailButton("Billing", billingUrl),
        emailParagraph("— Talentrah"),
      ].join("\n"),
    }),
  });
}

type Db = ReturnType<typeof createServiceRoleClient>;

/** Something that must be looked at went wrong while handling one Pass: it is listed, and the run answers not-ok (the cron route turns that into HTTP 500). */
function recordRenewalError(summary: RenewalJobSummary, userPassId: string, message: string) {
  summary.ok = false;
  summary.errors.push({ userPassId, message });
}

/** Postgres/PostgREST error text for a log line. Database text only; never card data, a token or an email. */
function dbCause(error: { code?: string; message?: string } | null | undefined): string {
  return error ? `database error ${error.code ?? "no-code"}: ${error.message ?? ""}`.trim() : "no row matched";
}

async function chargeDueRenewals(summary: RenewalJobSummary) {
  const supabase = createServiceRoleClient();
  const { data: due, error } = await supabase
    .from("user_passes")
    .select(
      "id, user_id, pass_id, authorization_code, expires_at, renewal_attempt_count, pending_renewal_reference, profiles!user_passes_user_id_fkey(email), passes(duration_days, price_ngn)",
    )
    .eq("auto_renew_status", "active")
    // A Pass whose owner's account was deleted (user_id null, 0209) must never be charged: there is no person to charge.
    .not("user_id", "is", null)
    .lte("next_renewal_date", todayDateOnly());

  if (error) {
    recordQueryFailure(summary, "charges", error.message);
    return;
  }

  for (const row of due ?? []) {
    try {
      const claimedAt = await claimForRenewal(supabase, row.id);
      if (!claimedAt) {
        // Another concurrent invocation (a retried manual trigger racing the
        // cron, or an overlapping cron fire) already has this row. Not an
        // error — this run simply lost the race for it and moves on.
        continue;
      }
      await chargeOne(supabase, row, summary, claimedAt);
    } catch (err) {
      summary.errors.push({
        userPassId: row.id,
        message: err instanceof Error ? err.message : "Unknown renewal error",
      });
    }
  }
}

/**
 * Atomic claim, in the same statement that re-checks eligibility — the same
 * shape as mentorship session reminders' `.is("reminder_sent_at", null)`
 * claim, applied here because `chargeDueRenewals`' plain SELECT gave two
 * concurrent job runs no way to know about each other before both reached
 * `chargeAuthorization` for the same Pass (proved directly: two concurrent
 * `runPassRenewalJob()` calls against one due Pass charged it twice).
 *
 * The `renewal_claimed_at` condition accepts a row with no claim OR a claim
 * older than the staleness window — so a run that crashed mid-charge doesn't
 * strand the Pass forever, without needing a separate reaper process.
 *
 * Returns the claim timestamp THIS call wrote, or null if its UPDATE matched no
 * row (the PostgREST equivalent of `UPDATE ... RETURNING id` being empty). The
 * timestamp is the fence every later write of this run is conditioned on: a
 * run whose claim has since gone stale and been taken by another cannot write
 * over that run's state.
 */
async function claimForRenewal(supabase: Db, userPassId: string): Promise<string | null> {
  const staleBefore = new Date(Date.now() - CLAIM_STALENESS_MINUTES * 60_000).toISOString();
  const claimedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from("user_passes")
    .update({ renewal_claimed_at: claimedAt })
    .eq("id", userPassId)
    .eq("auto_renew_status", "active")
    .lte("next_renewal_date", todayDateOnly())
    .or(`renewal_claimed_at.is.null,renewal_claimed_at.lt.${staleBefore}`)
    .select("id");

  if (error) throw error;
  return (data?.length ?? 0) > 0 ? claimedAt : null;
}

/* ── The charge reference is saved BEFORE the card is charged ─────────────────────────────────────────────
 * Until now the reference of a fresh charge lived only in memory until an outcome was known: a charge that succeeded followed by a failed write (or a dead process) left a due Pass
 * with no reference, and the next run minted a NEW one and charged the saved card again for the same period. The reference is now written, checked and fenced on this run's claim,
 * before `chargeAuthorization`; if that write fails, no charge is made.
 */

/** What a stored charge reference means at Paystack. Only an unambiguous answer lets anything be acted on. */
type ChargeReferenceVerdict =
  | { kind: "success"; settled: Awaited<ReturnType<typeof verifyTransaction>> }
  | { kind: "unfinished" }
  | { kind: "terminal_failure" }
  | { kind: "unknown" }
  | { kind: "indeterminate" };

/**
 * `unknown` ("Paystack never created this transaction") is HTTP 400 WITH the code `transaction_not_found` and nothing else (Paystack's own answer for a never-created reference, owner's
 * test-mode check of 17 Oct 2026). A 400 with another code (a bad request, a missing key, a malformed reference), a 401, 403, 404 or 429 says nothing about the reference, and so does a
 * network error: all of those are `indeterminate`, so nothing is charged. (For TRANSFERS the unknown answer is HTTP 404; the two are not the same and are not mixed.)
 */
async function checkChargeReference(reference: string): Promise<ChargeReferenceVerdict> {
  let settled;
  try {
    settled = await verifyTransaction(reference);
  } catch (err) {
    if (isDecline(err) && err.status === 400 && err.code === "transaction_not_found") return { kind: "unknown" };
    return { kind: "indeterminate" };
  }
  if (settled.status === "success") return { kind: "success", settled };
  if (isTerminalPaystackFailure(settled.status)) return { kind: "terminal_failure" };
  if (isUnrecognisedPaystackStatus(settled.status)) {
    console.warn(`[pass-renewal] unrecognised Paystack status "${String(settled.status).slice(0, 40)}" for ${reference}; treating it as unfinished.`);
  }
  return { kind: "unfinished" };
}

/** Writes the reference onto the Pass: fenced on this run's claim, on the Pass still being active, and on the value it replaces; exactly one row. True only when it is saved. */
async function saveChargeReference(supabase: Db, passId: string, claimedAt: string, reference: string, replaces: string | null): Promise<boolean> {
  let query = supabase
    .from("user_passes")
    .update({ pending_renewal_reference: reference })
    .eq("id", passId)
    .eq("auto_renew_status", "active")
    .eq("renewal_claimed_at", claimedAt);
  query = replaces === null ? query.is("pending_renewal_reference", null) : query.eq("pending_renewal_reference", replaces);
  const { data, error } = await query.select("id");
  if (error || data?.length !== 1) {
    console.error(`[pass-renewal] REFERENCE NOT SAVED pass=${passId} reference=${reference} cause=${dbCause(error)}. No charge was made.`);
    return false;
  }
  return true;
}

/** Best effort, checked: give the claim back so the Pass is not stuck behind its own staleness window. A failure is logged and changes nothing else. */
async function releaseClaim(supabase: Db, passId: string, claimedAt: string) {
  const { data, error } = await supabase.from("user_passes").update({ renewal_claimed_at: null }).eq("id", passId).eq("renewal_claimed_at", claimedAt).select("id");
  if (error || data?.length !== 1) console.error(`[pass-renewal] could not release the claim on pass=${passId} (${dbCause(error)}); it expires by itself.`);
}

async function chargeOne(
  supabase: Db,
  row: {
    id: string;
    user_id: string;
    pass_id: string;
    authorization_code: string | null;
    expires_at: string;
    renewal_attempt_count: number;
    pending_renewal_reference: string | null;
    profiles: { email: string } | null;
    passes: { duration_days: number; price_ngn: number } | null;
  },
  summary: RenewalJobSummary,
  claimedAt: string,
) {
  const email = row.profiles?.email;
  const pass = row.passes;

  // Can't actually recharge without both — lapse immediately rather than
  // leave a Pass permanently stuck "active" with nothing to charge.
  if (!email || !pass || !row.authorization_code) {
    // Nothing can be charged, but Paystack was not asked anything here either: a stored reference may be the only thread back to money that moved, so it stays (as it always did).
    await markLapsed(supabase, summary, row.id, { clearReference: false });
    return;
  }

  /*
   * Before charging: if a previous run left an attempt whose outcome we never
   * learned, settle THAT first.
   *
   * A timeout can happen after Paystack has already debited the card. Charging
   * again without checking would bill the customer twice for one period, which
   * is strictly worse than the bug this whole path exists to fix. If the
   * verify itself is indeterminate we cannot resolve it this run either, so we
   * back off rather than risk the double charge.
   */
  const stored = row.pending_renewal_reference;
  let reference: string;

  if (stored) {
    const verdict = await checkChargeReference(stored);
    if (verdict.kind === "success") {
      await applyVerifiedSuccess(supabase, row, pass, stored, verdict.settled, summary);
      return;
    }
    if (verdict.kind === "unfinished" || verdict.kind === "indeterminate") {
      /*
       * Paystack has not finished the PREVIOUS attempt (pending, processing, ongoing, queued, abandoned, or a status nobody has seen), or did not give an answer that says
       * anything about it: that first charge may still complete, so a fresh charge now could bill the customer twice for one period. Keep the reference, charge nothing, and count it
       * as one more indeterminate attempt (bounded: at MAX_INDETERMINATE_RENEWAL_ATTEMPTS the Pass lapses with the reference kept for a human). Only a terminal failure (failed,
       * reversed) or Paystack saying 400 transaction_not_found releases the reference below.
       */
      await recordIndeterminate(supabase, row, summary, stored, null, claimedAt);
      return;
    }
    if (verdict.kind === "unknown") {
      // Paystack never created it: ask again with the SAME reference.
      reference = stored;
    } else {
      // Terminal failure: that reference is spent. A new one replaces it on the Pass before anything is charged.
      reference = `pass_renewal_${randomUUID()}`;
      if (!(await saveChargeReference(supabase, row.id, claimedAt, reference, stored))) {
        await noChargeReferenceUnsaved(supabase, summary, row.id, claimedAt);
        return;
      }
    }
  } else {
    reference = `pass_renewal_${randomUUID()}`;
    if (!(await saveChargeReference(supabase, row.id, claimedAt, reference, null))) {
      await noChargeReferenceUnsaved(supabase, summary, row.id, claimedAt);
      return;
    }
  }

  let result;
  try {
    result = await chargeAuthorization({
      email,
      amountNgn: pass.price_ngn,
      authorizationCode: row.authorization_code,
      reference,
    });
  } catch (err) {
    if (!isDecline(err)) {
      /*
       * Anything that is not an affirmative decline. Paystack never answered,
       * or answered in a way this code cannot interpret — either way it says
       * nothing about the customer and must not be treated as their card
       * failing. Keep the Pass renewable, keep its token, keep
       * next_renewal_date so tomorrow's run retries, and record the attempt as
       * `pending` rather than `failed`, because the charge may in fact have
       * gone through.
       *
       * Note the direction of the test: only a KNOWN decline lapses. An
       * unrecognised error is evidence of nothing, and defaulting to "cancel
       * the paying customer" on evidence of nothing is precisely the bug.
       */
      await recordIndeterminate(supabase, row, summary, reference, pass.price_ngn, claimedAt);
      return;
    }

    if (reference === stored) {
      // A REUSED reference was refused. Paystack may be saying "that charge exists" rather than "no": ask once before lapsing a paying customer.
      const again = await checkChargeReference(reference);
      if (again.kind === "success") {
        await applyVerifiedSuccess(supabase, row, pass, reference, again.settled, summary);
        return;
      }
      if (again.kind === "unfinished" || again.kind === "indeterminate") {
        await recordIndeterminate(supabase, row, summary, reference, pass.price_ngn, claimedAt);
        return;
      }
    }

    // Paystack answered and said no — invalid/revoked authorization,
    // insufficient funds reported synchronously. Attributable to the customer,
    // so the original single-attempt lapse stands.
    await recordFailedCharge(supabase, row, pass, summary, reference, undefined);
    await markLapsed(supabase, summary, row.id, { clearReference: true });
    return;
  }

  /*
   * Same ground-truth check as the pending-recovery branch above and
   * fulfill.ts's fulfillPayment — status alone is not the whole claim.
   * Unlike that branch, a mismatch here is on a charge THIS run just made
   * (chargeAuthorization was called with pass.price_ngn NGN), so there is no
   * fresh-retry fallthrough to worry about racing: either it matches and the
   * Pass extends, or it doesn't and this is treated the same as any other
   * failed renewal — lapsed, recorded, and (distinctly, in the logs) flagged
   * as a mismatch rather than a plain decline, since the money still moved.
   */
  const expectedKobo = Math.round(pass.price_ngn * 100);
  const isCleanSuccess =
    result.status === "success" && result.amount === expectedKobo && result.currency === "NGN";

  if (!isCleanSuccess) {
    if (result.status === "success") {
      console.error(
        `[pass-renewal] MISMATCH on fresh renewal charge ${reference} for pass ${row.id}: expected ` +
          `${expectedKobo} kobo NGN, Paystack confirmed ${result.amount} ${result.currency}. Lapsing rather ` +
          `than granting an extension inconsistent with what was actually charged.`,
      );
    }
    await recordFailedCharge(supabase, row, pass, summary, reference, result.channel);
    // The reference is cleared only when Paystack affirms the charge did not go through; a "success" with the wrong amount, or a status that is not terminal, keeps the thread.
    await markLapsed(supabase, summary, row.id, { clearReference: isTerminalPaystackFailure(result.status) });
    return;
  }

  const extended = await extendPass(supabase, row, pass, reference, result.channel, summary, { recovered: false });
  if (extended.ok) summary.renewed++;
}

async function noChargeReferenceUnsaved(supabase: Db, summary: RenewalJobSummary, passId: string, claimedAt: string) {
  await releaseClaim(supabase, passId, claimedAt);
  recordRenewalError(summary, passId, "Renewal not attempted: the charge reference could not be saved first, so no charge was made. It will be retried on the next run.");
}

/**
 * A reference whose transaction Paystack reports as a SUCCESS (found when settling a stored reference). Same ground-truth check as fulfill.ts's fulfillPayment — status alone is not the
 * whole claim, and a recurring charge deserves the same backstop as a first one.
 *
 * On a mismatch this deliberately does NOT fall through to "not a success, clear it, try a fresh charge": Paystack is telling us THIS reference already succeeded, so attempting
 * chargeAuthorization again would risk a genuine double charge for one period. Should be unreachable in practice (the charge that created this reference was always requested with
 * pass.price_ngn NGN), which is exactly why a mismatch here is treated as needing a human rather than resolved automatically either way.
 */
async function applyVerifiedSuccess(
  supabase: Db,
  row: { id: string; user_id: string; pass_id: string; expires_at: string; authorization_code: string | null },
  pass: { duration_days: number; price_ngn: number },
  reference: string,
  settled: { amount: number; currency: string; channel: string },
  summary: RenewalJobSummary,
) {
  const expectedKobo = Math.round(pass.price_ngn * 100);
  if (settled.amount === expectedKobo && settled.currency === "NGN") {
    const extended = await extendPass(supabase, row, pass, reference, settled.channel, summary, { recovered: true });
    if (extended.ok) summary.renewed++;
    return;
  }
  console.error(
    `[pass-renewal] MISMATCH verifying pending renewal ${reference} for pass ` +
      `${row.id}: expected ${expectedKobo} kobo NGN, Paystack confirmed ${settled.amount} ` +
      `${settled.currency}. NOT extending. NOT retrying — Paystack already reports success for this ` +
      `reference, so a fresh charge would risk billing twice. Needs manual reconciliation.`,
  );
  const { error } = await supabase.from("payment_transactions").update({ status: "failed" }).eq("paystack_reference", reference);
  if (error) {
    console.error(`[pass-renewal] could not mark the mismatched payment ${reference} as failed (${dbCause(error)}).`);
    recordRenewalError(summary, row.id, `NEEDS RECONCILIATION: the payment row for ${reference} could not be marked failed (${dbCause(error)}).`);
  }
  await markLapsed(supabase, summary, row.id, { clearReference: false });
  summary.errors.push({
    userPassId: row.id,
    message: `NEEDS RECONCILIATION: amount/currency mismatch on reference ${reference}.`,
  });
}

/** A failed-charge payment row (a decline, a non-success status, or a mismatch on a fresh charge). The insert is checked; 23505 means the row already exists, which is fine. */
async function recordFailedCharge(
  supabase: Db,
  row: { id: string; user_id: string; pass_id: string },
  pass: { price_ngn: number },
  summary: RenewalJobSummary,
  reference: string,
  channel: string | undefined,
) {
  const { error } = await supabase.from("payment_transactions").insert({
    user_id: row.user_id,
    rail: "paystack",
    amount: pass.price_ngn,
    currency: "NGN",
    product_type: "pass",
    product_id: row.pass_id,
    paystack_reference: reference,
    status: "failed",
    ...(channel === undefined ? {} : { channel }),
    renewal_for_pass_id: row.id,
  });
  if (error && error.code !== "23505") {
    console.error(`[pass-renewal] could not record the failed charge ${reference} for pass=${row.id} (${dbCause(error)}).`);
    recordRenewalError(summary, row.id, `The failed charge ${reference} could not be recorded (${dbCause(error)}).`);
  }
}

/**
 * Records an attempt Paystack never resolved.
 *
 * Deliberately does NOT touch `auto_renew`, `auto_renew_status` or
 * `next_renewal_date` — leaving `next_renewal_date` intact is the entire
 * recovery mechanism, because the job's work-list query is
 * `next_renewal_date <= today`. Null it and the Pass is never seen again.
 *
 * The transaction row is `pending`, not `failed`: Paystack may have debited the
 * card before the connection dropped, and "failed" is a claim we cannot
 * support. It is also the record a human uses when reconciling.
 *
 * Every write here is checked: an attempt that could not be counted breaks the three-attempt bound, so it is loud (error log, `summary.errors`, `ok = false`) and is not reported as
 * recorded. The reference is already on the Pass (it was saved before the charge), so a failed write here loses nothing.
 */
async function recordIndeterminate(
  supabase: Db,
  row: { id: string; user_id: string; pass_id: string; renewal_attempt_count: number },
  summary: RenewalJobSummary,
  reference: string,
  amountNgn: number | null,
  claimedAt: string,
) {
  const attempts = row.renewal_attempt_count + 1;

  if (amountNgn !== null) {
    const { error } = await supabase.from("payment_transactions").insert({
      user_id: row.user_id,
      rail: "paystack",
      amount: amountNgn,
      currency: "NGN",
      product_type: "pass",
      product_id: row.pass_id,
      paystack_reference: reference,
      status: "pending",
      renewal_for_pass_id: row.id,
    });
    if (error && error.code !== "23505") {
      console.error(`[pass-renewal] could not record the pending payment ${reference} for pass=${row.id} (${dbCause(error)}).`);
      recordRenewalError(summary, row.id, `The pending payment ${reference} could not be recorded (${dbCause(error)}).`);
    }
  }

  if (attempts >= MAX_INDETERMINATE_RENEWAL_ATTEMPTS) {
    /*
     * Bounded, not infinite. Past this point the failure is no longer
     * plausibly transient, and promising a renewal that never happens is its
     * own dishonesty.
     *
     * This is the one genuinely bad outcome the whole design cannot rule out:
     * we give up while a charge of UNKNOWN outcome is still outstanding, so it
     * is possible the customer was debited and has now been lapsed anyway.
     * Nothing here can resolve that automatically — Paystack never answered,
     * three times.
     *
     * So `pending_renewal_reference` is deliberately NOT cleared. It is the
     * only thread back to the money: `user_passes_pending_renewal_idx` (0043)
     * makes those rows findable, the `payment_transactions` row stays
     * `pending` rather than being falsely marked failed, and the message below
     * says plainly that a human has to reconcile it. Clearing it to leave a
     * tidy row would destroy the evidence that someone may be owed a refund.
     */
    const lapsed = await markLapsed(supabase, summary, row.id, { clearReference: false });
    const counted = await supabase
      .from("user_passes")
      .update({ renewal_attempt_count: attempts, last_renewal_failure_at: new Date().toISOString() })
      .eq("id", row.id)
      .select("id");
    if (counted.error || counted.data?.length !== 1) {
      console.error(`[pass-renewal] could not record the give-up counters for pass=${row.id} reference=${reference} (${dbCause(counted.error)}).`);
      recordRenewalError(summary, row.id, `NEEDS RECONCILIATION: the give-up counters for ${reference} could not be written (${dbCause(counted.error)}).`);
    }
    if (lapsed) {
      summary.errors.push({
        userPassId: row.id,
        message:
          `NEEDS RECONCILIATION: lapsed after ${attempts} unresolved renewal attempts — Paystack never ` +
          `confirmed an outcome for reference ${reference}. The customer may have been charged. The ` +
          `payment_transactions row is still 'pending' and pending_renewal_reference is retained.`,
      });
    }
    return;
  }

  const { data, error } = await supabase
    .from("user_passes")
    .update({
      renewal_attempt_count: attempts,
      pending_renewal_reference: reference,
      last_renewal_failure_at: new Date().toISOString(),
      // This row deliberately STAYS due (next_renewal_date untouched) so a
      // later run retries it — release the claim now rather than making it
      // wait out CLAIM_STALENESS_MINUTES, which would turn a legitimate
      // same-day retry into an indefinite stall.
      renewal_claimed_at: null,
    })
    .eq("id", row.id)
    .eq("renewal_claimed_at", claimedAt)
    .select("id");
  if (error || data?.length !== 1) {
    console.error(`[pass-renewal] UNRECORDED indeterminate attempt pass=${row.id} reference=${reference} attempt=${attempts} cause=${dbCause(error)}. The attempt was not counted.`);
    recordRenewalError(summary, row.id, `Renewal outcome unknown for ${reference} and the attempt could not be recorded (${dbCause(error)}); it will be retried on the next run.`);
    return;
  }

  summary.indeterminate++;
  summary.errors.push({
    userPassId: row.id,
    message: `Renewal outcome unknown (attempt ${attempts}/${MAX_INDETERMINATE_RENEWAL_ATTEMPTS}) — will retry on the next run.`,
  });
}

type ExtendResult = { ok: true } | { ok: false; step: "extension"; error: string };

/**
 * Success path, shared by a fresh charge and a recovered pending one.
 *
 * ORDER: the payment row first (update-or-insert, every step checked), then the one `user_passes` update that extends the Pass. The payment-row failing never stops the extension (the
 * customer has paid): it is loud and the run answers not-ok. The extension failing after a successful charge never lapses the customer, never clears the reference and never touches
 * next_renewal_date: it is loud, listed as NEEDS RECONCILIATION, and the next run settles it through the stored reference.
 */
async function extendPass(
  supabase: Db,
  row: { id: string; user_id: string; pass_id: string; expires_at: string; authorization_code: string | null },
  pass: { duration_days: number; price_ngn: number },
  reference: string,
  channel: string,
  summary: RenewalJobSummary,
  opts: { recovered: boolean },
): Promise<ExtendResult> {
  /*
   * Update-or-insert on the reference rather than a plain insert. A recovered
   * pending attempt already has a row from the run that timed out, and that row
   * must be moved to `success` — inserting a second one would show the customer
   * two charges for a period they were billed for once, which is the same
   * misleading record this fix exists to avoid, just in the opposite direction.
   * Every step is checked: a failed READ is an error, never "no row".
   */
  const paymentRow = await recordPaymentSuccess(supabase, row, pass, reference, channel);
  if (!paymentRow.ok) {
    console.error(`[pass-renewal] PAYMENT ROW NOT RECORDED pass=${row.id} reference=${reference} amount=${pass.price_ngn} step=${paymentRow.step} cause=${paymentRow.error}. The Pass is still extended.`);
    recordRenewalError(summary, row.id, `The successful payment ${reference} could not be recorded (${paymentRow.step}: ${paymentRow.error}); the Pass was extended anyway.`);
  }

  const newExpiry = new Date(new Date(row.expires_at).getTime() + pass.duration_days * 24 * 60 * 60 * 1000);
  const newExpiryIso = newExpiry.toISOString();

  /*
   * A recovered success whose period is already in place. DECIDED ON INSTANTS, ALL IN UTC: next_renewal_date is the UTC calendar date of a Pass's expiry and the job selects
   * `next_renewal_date <= today (UTC)`, so a genuinely due Pass expires BEFORE the start of the next UTC day. A Pass whose expiry is at or after that instant has already been given the
   * period this payment bought; extending again would give a second period for one payment. Settle it in the ONE update: clear the reference and the retry state, and point
   * next_renewal_date at the UTC date of the expiry it already has so the Pass is not due again.
   */
  if (opts.recovered && Date.parse(row.expires_at) >= startOfNextUtcDay()) {
    const { data, error } = await supabase
      .from("user_passes")
      .update({
        next_renewal_date: new Date(Date.parse(row.expires_at)).toISOString().slice(0, 10),
        renewal_attempt_count: 0,
        pending_renewal_reference: null,
        renewal_claimed_at: null,
      })
      .eq("id", row.id)
      .select("id");
    if (error || data?.length !== 1) return extensionFailed(summary, row, pass, reference, row.expires_at, dbCause(error));
    return { ok: true };
  }

  const values = {
    expires_at: newExpiryIso,
    status: "active" as const,
    next_renewal_date: newExpiryIso.slice(0, 10),
    renewal_reminder_sent_at: null,
    // A resolved outcome clears the retry state, so an unrelated blip months
    // later starts from a clean count rather than inheriting an old one.
    renewal_attempt_count: 0,
    // The reference clear is part of THIS update, never a separate write: a second write could leave the reference set after the Pass is already extended (the next cycle would
    // verify it as a success and extend again without a charge) or clear it before the extension and lose the retry path.
    pending_renewal_reference: null,
    renewal_claimed_at: null,
  };
  const first = await supabase.from("user_passes").update(values).eq("id", row.id).select("id");
  if (!first.error && first.data?.length === 1) return { ok: true };
  if (!first.error) return extensionFailed(summary, row, pass, reference, newExpiryIso, "no row matched");

  // The database reported an error: ONE retry. It writes the SAME newExpiry (computed once above, never recomputed from a new read) and is fenced on the OLD expiry, so a first write that
  // had in fact committed cannot be applied a second time.
  const retry = await supabase.from("user_passes").update(values).eq("id", row.id).eq("expires_at", row.expires_at).select("id");
  if (!retry.error && retry.data?.length === 1) return { ok: true };
  if (!retry.error) {
    const { data: now } = await supabase.from("user_passes").select("expires_at").eq("id", row.id).maybeSingle();
    if (now && Date.parse(now.expires_at) === newExpiry.getTime()) return { ok: true };
    return extensionFailed(summary, row, pass, reference, newExpiryIso, "no row matched on the retry and the expiry is not the one intended");
  }
  return extensionFailed(summary, row, pass, reference, newExpiryIso, dbCause(retry.error));
}

function extensionFailed(
  summary: RenewalJobSummary,
  row: { id: string; user_id: string },
  pass: { price_ngn: number },
  reference: string,
  intendedExpiry: string,
  cause: string,
): ExtendResult {
  console.error(
    `[pass-renewal] CHARGED BUT NOT EXTENDED pass=${row.id} user=${row.user_id} reference=${reference} amount=${pass.price_ngn} intended_expiry=${intendedExpiry} cause=${cause}. ` +
      `Not lapsed; the reference and next_renewal_date are untouched, so the next run settles it through the stored reference.`,
  );
  recordRenewalError(
    summary,
    row.id,
    `NEEDS RECONCILIATION: charged but not extended. Reference ${reference}, amount ${pass.price_ngn} NGN, intended expiry ${intendedExpiry}. The Pass was not lapsed; the next run settles it through the stored reference.`,
  );
  return { ok: false, step: "extension", error: cause };
}

type PaymentRowResult = { ok: true } | { ok: false; step: "read" | "update" | "insert"; error: string };

/** The payment row for a successful renewal: a row for this reference is moved to success (never duplicated); otherwise one is inserted. Every step is checked. */
async function recordPaymentSuccess(
  supabase: Db,
  row: { id: string; user_id: string; pass_id: string; authorization_code: string | null },
  pass: { price_ngn: number },
  reference: string,
  channel: string,
): Promise<PaymentRowResult> {
  const toSuccess = async (id: string): Promise<PaymentRowResult> => {
    const { data, error } = await supabase
      .from("payment_transactions")
      .update({ status: "success", channel, authorization_code: row.authorization_code })
      .eq("id", id)
      .select("id");
    if (error || data?.length !== 1) return { ok: false, step: "update", error: dbCause(error) };
    return { ok: true };
  };

  const read = await supabase.from("payment_transactions").select("id").eq("paystack_reference", reference).maybeSingle();
  if (read.error) return { ok: false, step: "read", error: dbCause(read.error) };
  if (read.data) return toSuccess(read.data.id);

  const insert = await supabase.from("payment_transactions").insert({
    user_id: row.user_id,
    rail: "paystack",
    amount: pass.price_ngn,
    currency: "NGN",
    product_type: "pass",
    product_id: row.pass_id,
    paystack_reference: reference,
    status: "success",
    channel,
    authorization_code: row.authorization_code,
    renewal_for_pass_id: row.id,
  });
  if (!insert.error) return { ok: true };
  if (insert.error.code !== "23505") return { ok: false, step: "insert", error: dbCause(insert.error) };

  // Someone else just made the row: read it again and move IT to success. A unique violation is not simply success.
  const again = await supabase.from("payment_transactions").select("id").eq("paystack_reference", reference).maybeSingle();
  if (again.error) return { ok: false, step: "read", error: dbCause(again.error) };
  if (!again.data) return { ok: false, step: "read", error: "the row a unique violation pointed at could not be read" };
  return toSuccess(again.data.id);
}

/**
 * Ends a Pass's renewal. Checked: `lapsed` is counted only when the write worked; a failed lapse is loud and the Pass is retried tomorrow. `clearReference` is true when Paystack affirmed
 * the charge did not go through (a decline, a failed status) or there was nothing to charge: the reference is spent. It is false when money may have moved (the three-attempt give-up, a
 * mismatch), where the reference is the only thread back to it.
 */
async function markLapsed(supabase: Db, summary: RenewalJobSummary, userPassId: string, opts: { clearReference: boolean }): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_passes")
    .update({
      auto_renew: false,
      auto_renew_status: "lapsed",
      next_renewal_date: null,
      renewal_claimed_at: null,
      ...(opts.clearReference ? { pending_renewal_reference: null } : {}),
    })
    .eq("id", userPassId)
    .select("id");
  if (error || data?.length !== 1) {
    console.error(`[pass-renewal] could not lapse pass=${userPassId} (${dbCause(error)}); it will be tried again on the next run.`);
    recordRenewalError(summary, userPassId, `The lapse could not be recorded (${dbCause(error)}); it will be retried on the next run.`);
    return false;
  }
  summary.lapsed++;
  return true;
}

/**
 * Cancel-anytime (fix-prompt §1): stops future renewal attempts without
 * touching the currently-active period — expires_at/status are untouched.
 * Caller (the Server Action) is responsible for checking the Pass belongs
 * to the requesting user before calling this.
 *
 * Returns whether the Pass is now cancelled. An error, or a Pass that is neither still active nor already cancelled/lapsed, is `{ ok: false }`; the caller must not show success for it.
 */
export async function cancelPassAutoRenewal(userPassId: string): Promise<{ ok: boolean }> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("user_passes")
    .update({
      auto_renew: false,
      auto_renew_status: "canceled",
      next_renewal_date: null,
      // No longer needed once renewal is off — reduces stored-token surface.
      authorization_code: null,
    })
    .eq("id", userPassId)
    .eq("auto_renew_status", "active")
    .select("id");
  if (error) {
    console.error(`[pass-renewal] cancel failed for pass=${userPassId} (${dbCause(error)}).`);
    return { ok: false };
  }
  if (data?.length === 1) return { ok: true };

  // Matched no row: already cancelled (or lapsed) is a fine place to be; anything else is not.
  const { data: now, error: readError } = await supabase.from("user_passes").select("auto_renew_status").eq("id", userPassId).maybeSingle();
  if (!readError && (now?.auto_renew_status === "canceled" || now?.auto_renew_status === "lapsed")) return { ok: true };
  console.error(`[pass-renewal] cancel matched no active Pass for pass=${userPassId} (${readError ? dbCause(readError) : `status ${now?.auto_renew_status ?? "unknown"}`}).`);
  return { ok: false };
}
