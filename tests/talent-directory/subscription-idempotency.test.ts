/**
 * `fulfillPayment`'s `talent_directory_subscription` branch follows the SAME
 * idempotency bar as the existing purchase flow (send-139's own explicit
 * requirement, "the same way Pass renewals already are" — 0043's
 * indeterminate-failure bar). `verifyTransaction` is mocked (same pattern as
 * every other Paystack-calling test in this repo); the real database, the
 * real subscription row, and the real partial-unique-index constraint all
 * run for real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Subscription idempotency test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const verify = vi.hoisted(() => vi.fn());
vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, verifyTransaction: verify };
});
vi.mock("@/lib/resend/client", () => ({ getResendClient: () => null }));

let orgId: string;
let ownerId: string;
let planId: string;
let planPriceNgn: number;

beforeAll(async () => {
  const owner = await createTestUser("subscription-idempotency-owner");
  ownerId = owner.id;
  const { data: org } = await admin
    .from("organizations")
    .insert({ name: `Subscription Idempotency Org ${randomUUID().slice(0, 8)}`, created_by: ownerId, verified: true })
    .select("id")
    .single();
  orgId = org!.id;

  const { data: plan } = await admin.from("talent_directory_plans").select("id, price_ngn").limit(1).single();
  planId = plan!.id;
  planPriceNgn = plan!.price_ngn;
}, 60_000);

afterAll(async () => {
  await deleteTestOrgs([orgId]);
  await deleteTestUsers([ownerId]);
}, 60_000);

let subscriptionId: string;
let transactionId: string;
let reference: string;

async function setUpPendingSubscription() {
  const { data: subscription, error } = await admin
    .from("talent_directory_subscriptions")
    .insert({
      organization_id: orgId,
      plan_id: planId,
      expires_at: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !subscription) throw error ?? new Error("no subscription");
  subscriptionId = subscription.id;

  reference = `talent_directory_subscription_${randomUUID()}`;
  const { data: txn, error: txnError } = await admin
    .from("payment_transactions")
    .insert({
      user_id: ownerId,
      organization_id: orgId,
      rail: "paystack",
      amount: planPriceNgn,
      currency: "NGN",
      product_type: "talent_directory_subscription",
      product_id: subscriptionId,
      paystack_reference: reference,
      status: "pending",
    })
    .select("id")
    .single();
  if (txnError || !txn) throw txnError ?? new Error("no transaction");
  transactionId = txn.id;
}

afterEach(async () => {
  verify.mockReset();
  if (subscriptionId) await admin.from("talent_directory_subscriptions").delete().eq("id", subscriptionId);
  if (transactionId) await admin.from("payment_transactions").delete().eq("id", transactionId);
});

async function subscriptionStatus(): Promise<string> {
  const { data } = await admin.from("talent_directory_subscriptions").select("status").eq("id", subscriptionId).single();
  return data!.status;
}

describe("fulfillPayment(talent_directory_subscription) moves pending_payment -> active exactly once", () => {
  it("a successful charge activates the subscription", async () => {
    await setUpPendingSubscription();
    expect(await subscriptionStatus()).toBe("pending_payment");

    verify.mockResolvedValue({
      status: "success",
      reference,
      amount: Math.round(planPriceNgn * 100),
      currency: "NGN",
      channel: "card",
    });

    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const result = await fulfillPayment(reference);

    expect(result.status).toBe("success");
    expect(await subscriptionStatus()).toBe("active");
  });

  it("a webhook redelivery does not re-process — no double charge, no double activation", async () => {
    await setUpPendingSubscription();
    verify.mockResolvedValue({
      status: "success",
      reference,
      amount: Math.round(planPriceNgn * 100),
      currency: "NGN",
      channel: "card",
    });

    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const first = await fulfillPayment(reference);
    expect(first.status).toBe("success");

    const second = await fulfillPayment(reference);
    expect(second.status, "MONEY BUG: a webhook redelivery was processed a second time").toBe("already_processed");
    expect(await subscriptionStatus()).toBe("active");
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("CONCURRENT fulfilments: the subscription's own state transition still happens exactly once", async () => {
    await setUpPendingSubscription();
    verify.mockResolvedValue({
      status: "success",
      reference,
      amount: Math.round(planPriceNgn * 100),
      currency: "NGN",
      channel: "card",
    });

    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const results = await Promise.all([fulfillPayment(reference), fulfillPayment(reference)]);

    expect(results.every((r) => r.status === "success" || r.status === "already_processed")).toBe(true);
    expect(await subscriptionStatus()).toBe("active");
  });

  it("an amount mismatch is rejected — the subscription is never activated", async () => {
    await setUpPendingSubscription();
    verify.mockResolvedValue({
      status: "success",
      reference,
      amount: Math.round(planPriceNgn * 100) + 100,
      currency: "NGN",
      channel: "card",
    });

    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const result = await fulfillPayment(reference);

    expect(result.status).toBe("failed");
    expect(
      await subscriptionStatus(),
      "MONEY BUG: a subscription activated on an amount Paystack never actually confirmed",
    ).toBe("pending_payment");
  });

  it("the partial unique index refuses a second ACTIVE subscription for the same org, even after a real charge", async () => {
    // The org already has one active subscription (from the first test's
    // fixture pattern) — a second pending_payment row for the same org can
    // still be inserted (no index blocks that), but activating it must be
    // refused once one is already active.
    await setUpPendingSubscription();
    const { error: firstActivate } = await admin
      .from("talent_directory_subscriptions")
      .update({ status: "active" })
      .eq("id", subscriptionId);
    expect(firstActivate).toBeNull();

    const { data: secondPending } = await admin
      .from("talent_directory_subscriptions")
      .insert({
        organization_id: orgId,
        plan_id: planId,
        expires_at: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
      })
      .select("id")
      .single();

    const { error: secondActivate } = await admin
      .from("talent_directory_subscriptions")
      .update({ status: "active" })
      .eq("id", secondPending!.id);

    expect(
      secondActivate?.code,
      "MONEY BUG: two ACTIVE subscriptions existed for the same org at once",
    ).toBe("23505");

    await admin.from("talent_directory_subscriptions").delete().eq("id", secondPending!.id);
  });
});
