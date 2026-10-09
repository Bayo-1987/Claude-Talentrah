/**
 * The Talent Directory renewal job and overlapping runs (migration 0250, audit 9 Oct). runTalentDirectorySubscriptionRenewalJob selected every due subscription with a plain SELECT and charged each one's saved
 * card with a fresh reference, so two overlapping runs (the cron plus a manual POST, a platform retry) each read the same due row and BOTH charged the organisation. The Pass job closed the same hole in 0157. Now
 * a due row is CLAIMED with one conditional UPDATE before any Paystack call: the run that loses the claim skips the row. A claim older than the staleness window is reclaimable (a crashed run strands nothing),
 * and a row that is resolved or deliberately left due for a retry has its claim cleared.
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
  if (!process.env[key]) throw new Error(`Talent Directory renewal claim test cannot run: ${key} is not set.`);
}
const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const charge = vi.hoisted(() => vi.fn());
const verify = vi.hoisted(() => vi.fn());
vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, chargeAuthorization: charge, verifyTransaction: verify };
});
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => null }));

const MINUTE = 60_000;
let releaseLock: (() => Promise<void>) | undefined;
let userId = "";
let orgId = "";
let planId = "";
let planPriceNgn = 0;
let planDays = 0;
let subId = "NOT_SET";
let expiresAtBefore = "";

const ok = (reference: string) => ({ status: "success", reference, amount: Math.round(planPriceNgn * 100), currency: "NGN", channel: "card", gateway_response: "Approved" });

beforeAll(async () => {
  releaseLock = await acquireLock(admin, "talent_directory_renewal_job_invariant", "renewal-claim");
  userId = (await createTestUser("tdclaim")).id;
  const { data: org } = await admin.from("organizations").insert({ name: `TD Claim ${randomUUID().slice(0, 6)}`, created_by: userId, verified: true }).select("id").single();
  orgId = org!.id;
  await admin.from("organization_members").insert({ organization_id: orgId, user_id: userId, role: "owner" });
  const { data: plan, error } = await admin.from("talent_directory_plans").select("id, price_ngn, duration_days").limit(1).single();
  if (error || !plan) throw new Error("No Talent Directory plan seeded.");
  planId = plan.id;
  planPriceNgn = plan.price_ngn;
  planDays = plan.duration_days;
}, 300_000);

beforeEach(async () => {
  charge.mockReset();
  verify.mockReset();
  charge.mockImplementation(async (a: { reference: string }) => ok(a.reference));
  const today = new Date().toISOString().slice(0, 10);
  expiresAtBefore = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error } = await admin
    .from("talent_directory_subscriptions")
    .insert({ organization_id: orgId, plan_id: planId, status: "active", started_at: new Date(Date.now() - 31 * 86_400_000).toISOString(), expires_at: expiresAtBefore, authorization_code: "AUTH_test_reusable_code", auto_renew_status: "active", next_renewal_date: today })
    .select("id")
    .single();
  if (error || !data) throw new Error(`fixture subscription: ${error?.message}`);
  subId = data.id;
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

const run = async () => (await import("@/lib/talent-directory/renewals")).runTalentDirectorySubscriptionRenewalJob();
const sub = async () => (await admin.from("talent_directory_subscriptions").select("expires_at, next_renewal_date, renewal_claimed_at, renewal_attempt_count, pending_renewal_reference, auto_renew_status, status").eq("id", subId).single()).data!;
const payments = async () => (await admin.from("payment_transactions").select("status").eq("product_id", subId)).data ?? [];
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe("overlapping runs", () => {
  it("MONEY: two runs at once charge one due subscription ONCE, renew it once and write one payment row", async () => {
    const both = await Promise.all([run(), run()]);
    expect(charge, "DOUBLE CHARGE: both overlapping runs charged the saved card").toHaveBeenCalledTimes(1);
    expect(both.reduce((n, s) => n + s.renewed, 0)).toBe(1);
    expect(both.every((s) => s.ok)).toBe(true);
    const after = await sub();
    expect(new Date(after.expires_at).getTime(), "extended by exactly one plan period").toBe(new Date(expiresAtBefore).getTime() + planDays * 86_400_000);
    expect(await payments()).toEqual([{ status: "success" }]);
  });

  it("five runs at once: still one charge", async () => {
    await Promise.all(Array.from({ length: 5 }, () => run()));
    expect(charge).toHaveBeenCalledTimes(1);
    expect(await payments()).toHaveLength(1);
  });
});

describe("the claim window", () => {
  it("a subscription claimed a minute ago is left alone by a later run: no charge, no error, claim untouched", async () => {
    const claimedAt = ago(MINUTE);
    await admin.from("talent_directory_subscriptions").update({ renewal_claimed_at: claimedAt }).eq("id", subId);
    const summary = await run();
    expect(charge).not.toHaveBeenCalled();
    expect(summary.errors).toEqual([]);
    expect(summary.renewed).toBe(0);
    expect(new Date((await sub()).renewal_claimed_at!).getTime()).toBe(new Date(claimedAt).getTime());
  });

  it("a claim older than the window (a run that crashed mid-charge) is reclaimed and the subscription is renewed", async () => {
    await admin.from("talent_directory_subscriptions").update({ renewal_claimed_at: ago(20 * MINUTE) }).eq("id", subId);
    const summary = await run();
    expect(charge).toHaveBeenCalledTimes(1);
    expect(summary.renewed).toBe(1);
  });
});

describe("what a claim does not change", () => {
  it("a normal single renewal still charges once, extends the period, advances the renewal date and clears its claim", async () => {
    const summary = await run();
    expect(charge).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({ ok: true, renewed: 1, lapsed: 0 });
    const after = await sub();
    expect(new Date(after.expires_at).getTime()).toBe(new Date(expiresAtBefore).getTime() + planDays * 86_400_000);
    expect(after.next_renewal_date).toBe(after.expires_at.slice(0, 10));
    expect(after.renewal_claimed_at).toBeNull();
    expect(after.status).toBe("active");
    expect(await payments()).toEqual([{ status: "success" }]);
    // the next run finds nothing due
    await run();
    expect(charge).toHaveBeenCalledTimes(1);
  });

  it("a declined card lapses the subscription and clears its claim", async () => {
    const { PaystackDeclineError } = await import("@/lib/paystack/client");
    charge.mockRejectedValue(new PaystackDeclineError("Insufficient funds", 400));
    const summary = await run();
    expect(summary.lapsed).toBe(1);
    const after = await sub();
    expect(after.auto_renew_status).toBe("lapsed");
    expect(after.next_renewal_date).toBeNull();
    expect(after.renewal_claimed_at).toBeNull();
  });

  it("an unknown outcome (the charge timed out) keeps the reference for a retry and RELEASES the claim, so the next run can settle it without a second charge", async () => {
    const { PaystackUnavailableError } = await import("@/lib/paystack/client");
    charge.mockRejectedValue(new PaystackUnavailableError("timeout"));
    const first = await run();
    expect(first.indeterminate).toBe(1);
    const mid = await sub();
    expect(mid.pending_renewal_reference).toBeTruthy();
    expect(mid.renewal_attempt_count).toBe(1);
    expect(mid.renewal_claimed_at, "left claimed, a same-day retry would wait out the window").toBeNull();

    // The earlier charge turns out to have gone through: the next run settles it instead of charging again.
    charge.mockClear();
    verify.mockResolvedValue(ok(mid.pending_renewal_reference!));
    const second = await run();
    expect(charge, "a second charge for a payment that may have completed").not.toHaveBeenCalled();
    expect(second.renewed).toBe(1);
    expect((await sub()).pending_renewal_reference).toBeNull();
  });

  it("a subscription that is not due, or not renewing, is never claimed", async () => {
    await admin.from("talent_directory_subscriptions").update({ next_renewal_date: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10) }).eq("id", subId);
    await run();
    expect(charge).not.toHaveBeenCalled();
    expect((await sub()).renewal_claimed_at).toBeNull();
  });
});

describe("claimForRenewal itself: a run holding a stale work list cannot claim a row that has moved on", () => {
  // The work list is read first and the claim is made later, so between the two another run can have renewed (or lapsed) the row. The claim must re-check, in the same statement, that the row is STILL due and
  // STILL renewing; without that a slow second run claims the row the first run already renewed and charges the card again.
  const claim = async () => (await import("@/lib/talent-directory/renewals")).claimForRenewal(admin, subId);

  it("claims a due, renewing, unclaimed row - once", async () => {
    expect(await claim()).toBe(true);
    expect(await claim(), "a second claim inside the window").toBe(false);
  });

  it("refuses a row that another run has already renewed (its renewal date is now in the future)", async () => {
    await admin.from("talent_directory_subscriptions").update({ next_renewal_date: new Date(Date.now() + 29 * 86_400_000).toISOString().slice(0, 10), renewal_claimed_at: null }).eq("id", subId);
    expect(await claim()).toBe(false);
  });

  it("refuses a row that has lapsed or stopped renewing", async () => {
    await admin.from("talent_directory_subscriptions").update({ auto_renew_status: "lapsed" }).eq("id", subId);
    expect(await claim()).toBe(false);
  });
});
