/**
 * The Talent Directory subscription renewal job and a previous attempt that Paystack has not finished (the same rule as the Pass renewals, tests/billing/renewal-failure-modes.test.ts).
 * It used to treat any verify answer other than "success" for the previous attempt's reference as "that attempt failed" and charge again; if the first charge was still in flight that
 * bills the organisation twice for one period. Now an unfinished answer keeps the reference, charges nothing and counts one more indeterminate attempt; only failed / reversed releases it.
 * Paystack's client is faked; the job, the rows and the database are real. The job selects every due subscription account-wide, so the whole file holds a lease.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import { acquireLock } from "../support/operators-lock";
import { deleteOrgsCascade } from "../support/delete-orgs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Talent Directory renewal test cannot run: ${key} is not set.`);
}
const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const charge = vi.hoisted(() => vi.fn());
const verify = vi.hoisted(() => vi.fn());
vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, chargeAuthorization: charge, verifyTransaction: verify };
});
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => null }));

let releaseLock: (() => Promise<void>) | undefined;
let userId = "";
let orgId = "";
let planId = "";
let planPriceNgn = 0;
let subId = "NOT_SET";
const PENDING_REF = () => `talent_directory_subscription_renewal_${randomUUID()}`;
let pendingRef = "";

beforeAll(async () => {
  releaseLock = await acquireLock(admin, "talent_directory_renewal_job_invariant", "renewal-nonterminal");
  userId = (await createTestUser("tdrenew")).id;
  const { data: org } = await admin.from("organizations").insert({ name: `TD Renew ${randomUUID().slice(0, 6)}`, created_by: userId, verified: true }).select("id").single();
  orgId = org!.id;
  await admin.from("organization_members").insert({ organization_id: orgId, user_id: userId, role: "owner" });
  const { data: plan, error } = await admin.from("talent_directory_plans").select("id, price_ngn").limit(1).single();
  if (error || !plan) throw new Error("No Talent Directory plan seeded.");
  planId = plan.id;
  planPriceNgn = plan.price_ngn;
}, 300_000);

beforeEach(async () => {
  charge.mockReset();
  verify.mockReset();
  pendingRef = PENDING_REF();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await admin
    .from("talent_directory_subscriptions")
    .insert({
      organization_id: orgId, plan_id: planId, status: "active", started_at: new Date(Date.now() - 31 * 86_400_000).toISOString(), expires_at: new Date(Date.now() - 86_400_000).toISOString(),
      authorization_code: "AUTH_test_reusable_code", auto_renew_status: "active", next_renewal_date: today, pending_renewal_reference: pendingRef, renewal_attempt_count: 1,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture subscription: ${error?.message}`);
  subId = data.id;
  await admin.from("payment_transactions").insert({ user_id: userId, organization_id: orgId, rail: "paystack", amount: planPriceNgn, currency: "NGN", product_type: "talent_directory_subscription", product_id: subId, paystack_reference: pendingRef, status: "pending" });
});

afterEach(async () => {
  if (subId === "NOT_SET") return;
  await admin.from("payment_transactions").delete().eq("product_id", subId);
  await admin.from("talent_directory_subscriptions").delete().eq("id", subId);
  subId = "NOT_SET";
});

afterAll(async () => {
  try {
    await admin.from("talent_directory_subscriptions").delete().eq("organization_id", orgId);
    await admin.from("payment_transactions").delete().eq("organization_id", orgId);
    await deleteOrgsCascade(admin as never, [orgId]);
    if (userId) await deleteTestUsers([userId]);
  } finally {
    await releaseLock?.();
  }
}, 120_000);

const answer = (status: string) => ({ status, reference: pendingRef, amount: Math.round(planPriceNgn * 100), currency: "NGN", channel: "card" });
const subState = async () => (await admin.from("talent_directory_subscriptions").select("pending_renewal_reference, renewal_attempt_count, auto_renew_status").eq("id", subId).single()).data!;

describe("a previous renewal attempt that Paystack has not finished", () => {
  it.each(["pending", "processing", "ongoing", "queued", "abandoned", "a_status_nobody_has_seen"])("verifies as %s: no new charge, the reference is kept, the subscription stays renewable, the attempt is counted", async (status) => {
    verify.mockResolvedValue(answer(status));
    const { runTalentDirectorySubscriptionRenewalJob } = await import("@/lib/talent-directory/renewals");
    await runTalentDirectorySubscriptionRenewalJob();
    expect(charge, "DOUBLE-CHARGE RISK: charged again while the first charge may still complete").not.toHaveBeenCalled();
    const s = await subState();
    expect(s.pending_renewal_reference).toBe(pendingRef);
    expect(s.renewal_attempt_count).toBe(2);
    expect(s.auto_renew_status).toBe("active");
  });

  it("a third unfinished answer lapses the subscription with the reference kept for a human, still without a second charge", async () => {
    await admin.from("talent_directory_subscriptions").update({ renewal_attempt_count: 2 }).eq("id", subId);
    verify.mockResolvedValue(answer("processing"));
    const { runTalentDirectorySubscriptionRenewalJob } = await import("@/lib/talent-directory/renewals");
    await runTalentDirectorySubscriptionRenewalJob();
    expect(charge).not.toHaveBeenCalled();
    const s = await subState();
    expect(s.auto_renew_status).toBe("lapsed");
    expect(s.pending_renewal_reference).toBe(pendingRef);
  });

  it.each(["failed", "reversed"])("verifies as %s: the reference is released and a fresh charge is made, as before", async (status) => {
    verify.mockResolvedValue(answer(status));
    charge.mockResolvedValue({ status: "success", reference: "fresh", amount: Math.round(planPriceNgn * 100), currency: "NGN", channel: "card", gateway_response: "Approved" });
    const { runTalentDirectorySubscriptionRenewalJob } = await import("@/lib/talent-directory/renewals");
    await runTalentDirectorySubscriptionRenewalJob();
    expect(charge, "a genuinely failed earlier attempt is retried").toHaveBeenCalledTimes(1);
  });
});
