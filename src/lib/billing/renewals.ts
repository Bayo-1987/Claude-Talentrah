import "server-only";
import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { chargeAuthorization, verifyTransaction, isDecline } from "@/lib/paystack/client";
import { getResendClient } from "@/lib/resend/client";

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

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
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
 * Best-effort — this repo has no general notification pipeline yet
 * (Resend is currently only wired to the Contact form, see
 * src/lib/resend/client.ts). Reusing that same client here rather than
 * building new delivery infra, per the fix-prompt's explicit scope note.
 * If RESEND_API_KEY isn't configured, this silently no-ops rather than
 * blocking the recharge step — the billing page's "renews on <date>"
 * copy is the actual guaranteed in-app surface either way.
 */
async function sendReminderEmail(row: {
  id: string;
  next_renewal_date: string | null;
  profiles: { email: string; first_name: string | null } | null;
  passes: { name: string; price_ngn: number } | null;
}) {
  const resend = getResendClient();
  if (!resend || !row.profiles?.email) return;

  await resend.emails.send({
    from: "Talentrah <billing@talentrah.com>",
    to: row.profiles.email,
    subject: `Your ${row.passes?.name ?? "Pass"} renews soon`,
    text: `Hi${row.profiles.first_name ? ` ${row.profiles.first_name}` : ""},\n\nYour ${row.passes?.name ?? "Talentrah Pass"} will auto-renew on ${row.next_renewal_date} for ₦${(row.passes?.price_ngn ?? 0).toLocaleString()}, charged to the card on file. You can cancel auto-renewal anytime from your Billing page — this won't affect your current access either way.\n\n— Talentrah`,
  });
}

async function chargeDueRenewals(summary: RenewalJobSummary) {
  const supabase = createServiceRoleClient();
  const { data: due, error } = await supabase
    .from("user_passes")
    .select(
      "id, user_id, pass_id, authorization_code, expires_at, renewal_attempt_count, pending_renewal_reference, profiles!user_passes_user_id_fkey(email), passes(duration_days, price_ngn)",
    )
    .eq("auto_renew_status", "active")
    .lte("next_renewal_date", todayDateOnly());

  if (error) {
    recordQueryFailure(summary, "charges", error.message);
    return;
  }

  for (const row of due ?? []) {
    try {
      await chargeOne(supabase, row, summary);
    } catch (err) {
      summary.errors.push({
        userPassId: row.id,
        message: err instanceof Error ? err.message : "Unknown renewal error",
      });
    }
  }
}

async function chargeOne(
  supabase: ReturnType<typeof createServiceRoleClient>,
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
) {
  const email = row.profiles?.email;
  const pass = row.passes;

  // Can't actually recharge without both — lapse immediately rather than
  // leave a Pass permanently stuck "active" with nothing to charge.
  if (!email || !pass || !row.authorization_code) {
    await markLapsed(supabase, row.id);
    summary.lapsed++;
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
  if (row.pending_renewal_reference) {
    let settled;
    try {
      settled = await verifyTransaction(row.pending_renewal_reference);
    } catch (err) {
      if (!isDecline(err)) {
        // Could not learn this reference's fate. Backing off is the only safe
        // move: charging again might be the second charge for one period.
        await recordIndeterminate(supabase, row, summary, row.pending_renewal_reference, null);
        return;
      }
      // Paystack answered about this reference and it was not a success —
      // a real, attributable outcome. Fall through and charge afresh.
      settled = null;
    }

    if (settled?.status === "success") {
      await extendPass(supabase, row, pass, row.pending_renewal_reference, settled.channel, {
        transactionAlreadyRecorded: false,
      });
      summary.renewed++;
      return;
    }
    // Not a success — clear it so the fresh attempt below owns the state.
    await supabase
      .from("user_passes")
      .update({ pending_renewal_reference: null })
      .eq("id", row.id);
  }

  const reference = `pass_renewal_${randomUUID()}`;
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
      await recordIndeterminate(supabase, row, summary, reference, pass.price_ngn);
      return;
    }

    // Paystack answered and said no — invalid/revoked authorization,
    // insufficient funds reported synchronously. Attributable to the customer,
    // so the original single-attempt lapse stands.
    await supabase.from("payment_transactions").insert({
      user_id: row.user_id,
      rail: "paystack",
      amount: pass.price_ngn,
      currency: "NGN",
      product_type: "pass",
      product_id: row.pass_id,
      paystack_reference: reference,
      status: "failed",
      renewal_for_pass_id: row.id,
    });
    await markLapsed(supabase, row.id);
    summary.lapsed++;
    return;
  }

  if (result.status !== "success") {
    await supabase.from("payment_transactions").insert({
      user_id: row.user_id,
      rail: "paystack",
      amount: pass.price_ngn,
      currency: "NGN",
      product_type: "pass",
      product_id: row.pass_id,
      paystack_reference: reference,
      status: "failed",
      channel: result.channel,
      renewal_for_pass_id: row.id,
    });
    await markLapsed(supabase, row.id);
    summary.lapsed++;
    return;
  }

  await extendPass(supabase, row, pass, reference, result.channel, {
    transactionAlreadyRecorded: false,
  });
  summary.renewed++;
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
 */
async function recordIndeterminate(
  supabase: ReturnType<typeof createServiceRoleClient>,
  row: { id: string; user_id: string; pass_id: string; renewal_attempt_count: number },
  summary: RenewalJobSummary,
  reference: string,
  amountNgn: number | null,
) {
  const attempts = row.renewal_attempt_count + 1;

  if (amountNgn !== null) {
    await supabase.from("payment_transactions").insert({
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
  }

  if (attempts >= MAX_INDETERMINATE_RENEWAL_ATTEMPTS) {
    // Bounded, not infinite. Past this point the failure is no longer
    // plausibly transient, and promising a renewal that never happens is its
    // own dishonesty.
    await markLapsed(supabase, row.id);
    await supabase
      .from("user_passes")
      .update({ renewal_attempt_count: attempts, last_renewal_failure_at: new Date().toISOString() })
      .eq("id", row.id);
    summary.lapsed++;
    summary.errors.push({
      userPassId: row.id,
      message: `Lapsed after ${attempts} unresolved renewal attempts — Paystack never confirmed an outcome.`,
    });
    return;
  }

  await supabase
    .from("user_passes")
    .update({
      renewal_attempt_count: attempts,
      pending_renewal_reference: reference,
      last_renewal_failure_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  summary.indeterminate++;
  summary.errors.push({
    userPassId: row.id,
    message: `Renewal outcome unknown (attempt ${attempts}/${MAX_INDETERMINATE_RENEWAL_ATTEMPTS}) — will retry on the next run.`,
  });
}

/** Success path, shared by a fresh charge and a recovered pending one. */
async function extendPass(
  supabase: ReturnType<typeof createServiceRoleClient>,
  row: { id: string; user_id: string; pass_id: string; expires_at: string; authorization_code: string | null },
  pass: { duration_days: number; price_ngn: number },
  reference: string,
  channel: string,
  opts: { transactionAlreadyRecorded: boolean },
) {
  if (!opts.transactionAlreadyRecorded) {
    // Upsert on the reference: a recovered pending attempt already has a row
    // from the run that timed out, and it must be updated to `success` rather
    // than duplicated.
    const { data: existing } = await supabase
      .from("payment_transactions")
      .select("id")
      .eq("paystack_reference", reference)
      .maybeSingle();

    if (existing) {
      await supabase
        .from("payment_transactions")
        .update({ status: "success", channel, authorization_code: row.authorization_code })
        .eq("id", existing.id);
    } else {
      await supabase.from("payment_transactions").insert({
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
    }
  }

  const newExpiry = new Date(new Date(row.expires_at).getTime() + pass.duration_days * 24 * 60 * 60 * 1000);
  const newExpiryIso = newExpiry.toISOString();
  await supabase
    .from("user_passes")
    .update({
      expires_at: newExpiryIso,
      status: "active",
      next_renewal_date: newExpiryIso.slice(0, 10),
      renewal_reminder_sent_at: null,
      // A resolved outcome clears the retry state, so an unrelated blip months
      // later starts from a clean count rather than inheriting an old one.
      renewal_attempt_count: 0,
      pending_renewal_reference: null,
    })
    .eq("id", row.id);
}

async function markLapsed(supabase: ReturnType<typeof createServiceRoleClient>, userPassId: string) {
  await supabase
    .from("user_passes")
    .update({
      auto_renew: false,
      auto_renew_status: "lapsed",
      next_renewal_date: null,
    })
    .eq("id", userPassId);
}

/**
 * Cancel-anytime (fix-prompt §1): stops future renewal attempts without
 * touching the currently-active period — expires_at/status are untouched.
 * Caller (the Server Action) is responsible for checking the Pass belongs
 * to the requesting user before calling this.
 */
export async function cancelPassAutoRenewal(userPassId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase
    .from("user_passes")
    .update({
      auto_renew: false,
      auto_renew_status: "canceled",
      next_renewal_date: null,
      // No longer needed once renewal is off — reduces stored-token surface.
      authorization_code: null,
    })
    .eq("id", userPassId);
}
