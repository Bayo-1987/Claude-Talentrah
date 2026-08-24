import "server-only";
import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { chargeAuthorization } from "@/lib/paystack/client";
import { getResendClient } from "@/lib/resend/client";

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
      "id, user_id, pass_id, authorization_code, expires_at, profiles!user_passes_user_id_fkey(email), passes(duration_days, price_ngn)",
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

  const reference = `pass_renewal_${randomUUID()}`;
  let result;
  try {
    result = await chargeAuthorization({
      email,
      amountNgn: pass.price_ngn,
      authorizationCode: row.authorization_code,
      reference,
    });
  } catch {
    // Paystack rejected the charge outright (invalid/revoked authorization,
    // insufficient funds reported synchronously, etc).
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

  await supabase.from("payment_transactions").insert({
    user_id: row.user_id,
    rail: "paystack",
    amount: pass.price_ngn,
    currency: "NGN",
    product_type: "pass",
    product_id: row.pass_id,
    paystack_reference: reference,
    status: "success",
    channel: result.channel,
    authorization_code: row.authorization_code,
    renewal_for_pass_id: row.id,
  });

  const newExpiry = new Date(new Date(row.expires_at).getTime() + pass.duration_days * 24 * 60 * 60 * 1000);
  const newExpiryIso = newExpiry.toISOString();
  await supabase
    .from("user_passes")
    .update({
      expires_at: newExpiryIso,
      status: "active",
      next_renewal_date: newExpiryIso.slice(0, 10),
      renewal_reminder_sent_at: null,
    })
    .eq("id", row.id);

  summary.renewed++;
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
