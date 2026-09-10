import "server-only";
import { randomUUID } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { chargeAuthorization, verifyTransaction, isDecline } from "@/lib/paystack/client";

/**
 * The Talent Directory subscription renewal job — a structural fork of
 * `runPassRenewalJob` (src/lib/billing/renewals.ts), not a call into it:
 * that file is written directly against `user_passes`/`profiles`, and
 * `talent_directory_subscriptions` is org-owned (0135's own header explains
 * why it can't reuse `user_passes` — `user_id` there is a hard FK to
 * `profiles` with no org-owned equivalent). Every decision below —
 * indeterminate-outcome retry rather than immediate lapse, ground-truth
 * amount/currency re-check rather than trusting `status` alone, ONLY a known
 * decline lapses — is copied deliberately from that file's own hard-won
 * reasoning (0043), not re-derived.
 *
 * LEANER THAN THE PASS JOB ON PURPOSE: no separate reminder-email phase.
 * "Honestly scoped down" applies to this fork too — a renewal reminder is a
 * real gap, not an oversight, and the founder can decide whether it is worth
 * building once real subscribers exist.
 *
 * WHY product_id ON THE RENEWAL CHARGE IS THE SAME talent_directory_subscriptions.id,
 * with no separate "renewal_for_X_id" column the way user_passes needed one:
 * a Pass's `payment_transactions.product_id` is the CATALOG pass id (the same
 * on every renewal), so a second column was needed to point at the specific
 * `user_passes` instance being renewed. This feature's own initial-purchase
 * branch in fulfill.ts already sets `product_id` to the SUBSCRIPTION
 * INSTANCE's own id (not the plan catalog id) — so a renewal charge using
 * that same id needs no extra column to stay traceable to the right row.
 */
export const MAX_INDETERMINATE_SUBSCRIPTION_RENEWAL_ATTEMPTS = 3;

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface SubscriptionRenewalSummary {
  ok: boolean;
  renewed: number;
  lapsed: number;
  indeterminate: number;
  errors: Array<{ subscriptionId: string; message: string }>;
  queryErrors: Array<{ message: string }>;
}

export async function runTalentDirectorySubscriptionRenewalJob(): Promise<SubscriptionRenewalSummary> {
  const summary: SubscriptionRenewalSummary = {
    ok: true,
    renewed: 0,
    lapsed: 0,
    indeterminate: 0,
    errors: [],
    queryErrors: [],
  };

  const supabase = createServiceRoleClient();
  const { data: due, error } = await supabase
    .from("talent_directory_subscriptions")
    .select(
      "id, organization_id, plan_id, authorization_code, expires_at, renewal_attempt_count, pending_renewal_reference, organizations(name, created_by), talent_directory_plans(duration_days, price_ngn)",
    )
    .eq("auto_renew_status", "active")
    .lte("next_renewal_date", todayDateOnly());

  if (error) {
    console.error(`[talent-directory-renewal] work-list query failed: ${error.message}`);
    summary.ok = false;
    summary.queryErrors.push({ message: error.message });
    return summary;
  }

  for (const row of due ?? []) {
    try {
      await chargeOne(supabase, row, summary);
    } catch (err) {
      summary.errors.push({
        subscriptionId: row.id,
        message: err instanceof Error ? err.message : "Unknown renewal error",
      });
    }
  }

  return summary;
}

interface DueSubscriptionRow {
  id: string;
  organization_id: string;
  plan_id: string;
  authorization_code: string | null;
  expires_at: string;
  renewal_attempt_count: number;
  pending_renewal_reference: string | null;
  organizations: { name: string; created_by: string } | null;
  talent_directory_plans: { duration_days: number; price_ngn: number } | null;
}

async function chargeOne(
  supabase: ReturnType<typeof createServiceRoleClient>,
  row: DueSubscriptionRow,
  summary: SubscriptionRenewalSummary,
) {
  const plan = row.talent_directory_plans;
  const billingUserId = row.organizations?.created_by;

  // Billed to whoever created the org (there is no separate "billing
  // contact" column — see 0135's own header). Cannot actually recharge
  // without an authorization code either — lapse rather than leave this
  // stuck "active" with nothing to charge.
  if (!billingUserId || !plan || !row.authorization_code) {
    await markLapsed(supabase, row.id);
    summary.lapsed++;
    return;
  }

  const { data: billingUser } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", billingUserId)
    .maybeSingle();
  const email = billingUser?.email;
  if (!email) {
    await markLapsed(supabase, row.id);
    summary.lapsed++;
    return;
  }

  // Settle a previous run's unresolved attempt before charging again — same
  // reasoning as renewals.ts's own chargeOne: a timeout can happen after
  // Paystack already debited the card.
  if (row.pending_renewal_reference) {
    let settled;
    try {
      settled = await verifyTransaction(row.pending_renewal_reference);
    } catch (err) {
      if (!isDecline(err)) {
        await recordIndeterminate(supabase, row, summary, row.pending_renewal_reference, null);
        return;
      }
      settled = null;
    }

    if (settled?.status === "success") {
      const expectedKobo = Math.round(plan.price_ngn * 100);
      if (settled.amount === expectedKobo && settled.currency === "NGN") {
        await extendSubscription(supabase, row, plan, row.pending_renewal_reference, settled.channel);
        summary.renewed++;
        return;
      }
      console.error(
        `[talent-directory-renewal] MISMATCH verifying pending renewal ${row.pending_renewal_reference} for ` +
          `subscription ${row.id}: expected ${expectedKobo} kobo NGN, Paystack confirmed ${settled.amount} ` +
          `${settled.currency}. NOT extending, NOT retrying — needs manual reconciliation.`,
      );
      await supabase.from("payment_transactions").update({ status: "failed" }).eq("paystack_reference", row.pending_renewal_reference);
      await markLapsed(supabase, row.id);
      summary.lapsed++;
      summary.errors.push({
        subscriptionId: row.id,
        message: `NEEDS RECONCILIATION: amount/currency mismatch on reference ${row.pending_renewal_reference}.`,
      });
      return;
    }
    await supabase.from("talent_directory_subscriptions").update({ pending_renewal_reference: null }).eq("id", row.id);
  }

  const reference = `talent_directory_subscription_renewal_${randomUUID()}`;
  let result;
  try {
    result = await chargeAuthorization({
      email,
      amountNgn: plan.price_ngn,
      authorizationCode: row.authorization_code,
      reference,
    });
  } catch (err) {
    if (!isDecline(err)) {
      await recordIndeterminate(supabase, row, summary, reference, plan.price_ngn);
      return;
    }
    await supabase.from("payment_transactions").insert({
      user_id: billingUserId,
      organization_id: row.organization_id,
      rail: "paystack",
      amount: plan.price_ngn,
      currency: "NGN",
      product_type: "talent_directory_subscription",
      product_id: row.id,
      paystack_reference: reference,
      status: "failed",
    });
    await markLapsed(supabase, row.id);
    summary.lapsed++;
    return;
  }

  const expectedKobo = Math.round(plan.price_ngn * 100);
  const isCleanSuccess = result.status === "success" && result.amount === expectedKobo && result.currency === "NGN";

  if (!isCleanSuccess) {
    if (result.status === "success") {
      console.error(
        `[talent-directory-renewal] MISMATCH on fresh renewal charge ${reference} for subscription ${row.id}: ` +
          `expected ${expectedKobo} kobo NGN, Paystack confirmed ${result.amount} ${result.currency}. Lapsing.`,
      );
    }
    await supabase.from("payment_transactions").insert({
      user_id: billingUserId,
      organization_id: row.organization_id,
      rail: "paystack",
      amount: plan.price_ngn,
      currency: "NGN",
      product_type: "talent_directory_subscription",
      product_id: row.id,
      paystack_reference: reference,
      status: "failed",
      channel: result.channel,
    });
    await markLapsed(supabase, row.id);
    summary.lapsed++;
    return;
  }

  await extendSubscription(supabase, row, plan, reference, result.channel);
  summary.renewed++;
}

async function recordIndeterminate(
  supabase: ReturnType<typeof createServiceRoleClient>,
  row: DueSubscriptionRow,
  summary: SubscriptionRenewalSummary,
  reference: string,
  amountNgn: number | null,
) {
  const attempts = row.renewal_attempt_count + 1;

  if (amountNgn !== null) {
    await supabase.from("payment_transactions").insert({
      user_id: row.organizations?.created_by ?? row.organization_id,
      organization_id: row.organization_id,
      rail: "paystack",
      amount: amountNgn,
      currency: "NGN",
      product_type: "talent_directory_subscription",
      product_id: row.id,
      paystack_reference: reference,
      status: "pending",
    });
  }

  if (attempts >= MAX_INDETERMINATE_SUBSCRIPTION_RENEWAL_ATTEMPTS) {
    // pending_renewal_reference deliberately NOT cleared — same reasoning as
    // renewals.ts's own recordIndeterminate: it is the only thread back to
    // an unresolved charge, for a human to reconcile.
    await markLapsed(supabase, row.id);
    await supabase
      .from("talent_directory_subscriptions")
      .update({ renewal_attempt_count: attempts, last_renewal_failure_at: new Date().toISOString() })
      .eq("id", row.id);
    summary.lapsed++;
    summary.errors.push({
      subscriptionId: row.id,
      message: `NEEDS RECONCILIATION: lapsed after ${attempts} unresolved renewal attempts — Paystack never confirmed an outcome for reference ${reference}. The org may have been charged. pending_renewal_reference is retained.`,
    });
    return;
  }

  await supabase
    .from("talent_directory_subscriptions")
    .update({
      renewal_attempt_count: attempts,
      pending_renewal_reference: reference,
      last_renewal_failure_at: new Date().toISOString(),
    })
    .eq("id", row.id);

  summary.indeterminate++;
  summary.errors.push({
    subscriptionId: row.id,
    message: `Renewal outcome unknown (attempt ${attempts}/${MAX_INDETERMINATE_SUBSCRIPTION_RENEWAL_ATTEMPTS}) — will retry on the next run.`,
  });
}

async function extendSubscription(
  supabase: ReturnType<typeof createServiceRoleClient>,
  row: DueSubscriptionRow,
  plan: { duration_days: number; price_ngn: number },
  reference: string,
  channel: string,
) {
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
      user_id: row.organizations?.created_by ?? row.organization_id,
      organization_id: row.organization_id,
      rail: "paystack",
      amount: plan.price_ngn,
      currency: "NGN",
      product_type: "talent_directory_subscription",
      product_id: row.id,
      paystack_reference: reference,
      status: "success",
      channel,
      authorization_code: row.authorization_code,
    });
  }

  const newExpiry = new Date(new Date(row.expires_at).getTime() + plan.duration_days * 24 * 60 * 60 * 1000);
  const newExpiryIso = newExpiry.toISOString();
  await supabase
    .from("talent_directory_subscriptions")
    .update({
      expires_at: newExpiryIso,
      status: "active",
      next_renewal_date: newExpiryIso.slice(0, 10),
      renewal_reminder_sent_at: null,
      renewal_attempt_count: 0,
      pending_renewal_reference: null,
    })
    .eq("id", row.id);
}

async function markLapsed(supabase: ReturnType<typeof createServiceRoleClient>, subscriptionId: string) {
  await supabase
    .from("talent_directory_subscriptions")
    .update({
      status: "lapsed",
      auto_renew_status: "lapsed",
      next_renewal_date: null,
    })
    .eq("id", subscriptionId);
}
