/**
 * A Paystack outage must not cancel a paying customer's subscription.
 *
 * THE BUG THIS WAS WRITTEN AGAINST. `chargeOne` in src/lib/billing/renewals.ts
 * wrapped `chargeAuthorization` in a bare `catch {}` whose comment asserted one
 * cause — "Paystack rejected the charge outright" — for every possible one. A
 * timeout, a DNS failure, a 502 from Paystack's own edge and a genuine "card
 * declined" all landed in the same branch, and that branch calls `markLapsed`:
 *
 *     auto_renew: false, auto_renew_status: 'lapsed', next_renewal_date: null
 *
 * `next_renewal_date: null` is the part that makes it permanent — the job
 * selects on `next_renewal_date <= today`, so a lapsed Pass is never looked at
 * again. One dropped connection ended a subscription that the customer was
 * paying for and had done nothing wrong to lose, and no retry existed to undo
 * it because the design deliberately has none.
 *
 * WORTH BEING PRECISE ABOUT THE BLAST RADIUS, because the brief overstated it
 * in one respect and understated it in another:
 *   * `markLapsed` does NOT clear `authorization_code` — only
 *     `cancelPassAutoRenewal` does that. So the stored token survives and
 *     recovery is possible in principle.
 *   * But a `payment_transactions` row is written with `status: 'failed'` on a
 *     timeout, and that is a claim we cannot support. Paystack may well have
 *     charged the card before the connection dropped. Recording "failed" for a
 *     charge that may have succeeded is how a customer gets debited and lapsed
 *     in the same run.
 *
 * These tests drive the real `runPassRenewalJob` against the live database with
 * only the Paystack client mocked — the lapse decision, the transaction row and
 * the Pass mutation are all real. Verified before writing them that production
 * holds zero `user_passes` rows, so the job has no real card to touch.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Renewal failure-mode test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const charge = vi.hoisted(() => vi.fn());
const verify = vi.hoisted(() => vi.fn());

vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>(
    "@/lib/paystack/client",
  );
  return { ...actual, chargeAuthorization: charge, verifyTransaction: verify };
});

// Email is stubbed out — the reminder stage is not under test and sending is
// not something a test should do.
vi.mock("@/lib/resend/client", () => ({ getResendClient: () => null }));

let userId: string;
let passId: string;
/**
 * The Pass under test. Reset to a sentinel at the START of every setup, and
 * that is load-bearing rather than tidiness.
 *
 * The first version of this fixture minted a fresh auth user per test with a
 * raw `admin.auth.admin.createUser`. Under full-suite load that call is the one
 * that trips Supabase Auth's rate limit — and when it threw, `userPassId` kept
 * the PREVIOUS test's value, so the assertions silently ran against the last
 * test's Pass. That produced exactly the symptoms seen in CI: "expected 1
 * transaction, got 2" and a `pending_renewal_reference` that was never set,
 * both intermittent and both passing in isolation. The failure looked like a
 * product bug and was a fixture bug.
 *
 * Two fixes, both needed: the sentinel below turns a partial setup into an
 * obvious error instead of a wrong-target assertion, and the suite now creates
 * ONE user for the whole file via the retrying helper rather than seven raw
 * ones — the mitigation `tests/support/auth.ts` exists for.
 */
let userPassId = "NOT_SET";

/** One account for the file. No test here needs isolation between users — the
 *  thing under test is a Pass, and each test gets a fresh one. */
async function setUpSharedUser() {
  const user = await createTestUser("renewfail");
  userId = user.id;

  const { data: pass, error: passErr } = await admin
    .from("passes")
    .select("id, price_ngn, duration_days")
    .limit(1)
    .single();
  if (passErr || !pass) throw new Error("No passes seeded — run `npm run seed`.");
  passId = pass.id;
}

async function setUpDuePass() {
  userPassId = "NOT_SET";

  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const { data: up, error: upErr } = await admin
    .from("user_passes")
    .insert({
      user_id: userId,
      pass_id: passId,
      started_at: yesterday,
      expires_at: yesterday,
      payment_method: "card",
      auto_renew: true,
      auto_renew_status: "active",
      next_renewal_date: new Date().toISOString().slice(0, 10),
      authorization_code: "AUTH_test_reusable_code",
    })
    .select("id")
    .single();
  if (upErr) throw upErr;
  userPassId = up.id;
}

async function passState() {
  const { data } = await admin
    .from("user_passes")
    .select("auto_renew, auto_renew_status, next_renewal_date, authorization_code")
    .eq("id", userPassId)
    .single();
  return data!;
}

async function transactionsForPass() {
  const { data } = await admin
    .from("payment_transactions")
    .select("status, paystack_reference, amount")
    .eq("renewal_for_pass_id", userPassId);
  return data ?? [];
}

beforeAll(setUpSharedUser);

beforeEach(async () => {
  charge.mockReset();
  verify.mockReset();
  await setUpDuePass();
  // If setup failed we must not assert against a stale target.
  expect(userPassId, "fixture did not create a Pass for this test").not.toBe("NOT_SET");
});

afterEach(async () => {
  if (userPassId === "NOT_SET") return;
  await admin.from("payment_transactions").delete().eq("renewal_for_pass_id", userPassId);
  await admin.from("user_passes").delete().eq("id", userPassId);
});

afterAll(async () => {
  // Belt and braces: any Pass this file leaked would otherwise stay DUE, and
  // runPassRenewalJob is global — a stray due Pass would be picked up by a
  // later run and mutated out from under whatever created it.
  if (userId) {
    await admin.from("user_passes").delete().eq("user_id", userId);
    await deleteTestUsers([userId]);
  }
  vi.restoreAllMocks();
}, 60_000);

/** A network-level failure: Paystack never answered. */
function timeoutError() {
  const err = new Error("The operation was aborted due to timeout");
  err.name = "TimeoutError";
  return err;
}

describe("a genuine decline still ends the subscription", () => {
  it("Paystack answered and said no: the Pass lapses immediately", async () => {
    /*
     * POSITIVE CONTROL, and the reason it comes first. The single-attempt lapse
     * on a real decline is a deliberate product decision from the original
     * renewal build ("no retry/dunning, a single failed attempt is enough").
     * Making declines survivable while fixing timeouts would be a worse bug
     * than the one being fixed, so this pins the behaviour that must NOT
     * change.
     */
    const { PaystackDeclineError } = await import("@/lib/paystack/client");
    charge.mockRejectedValue(new PaystackDeclineError("Insufficient funds"));

    const { runPassRenewalJob } = await import("@/lib/billing/renewals");
    const summary = await runPassRenewalJob();
    expect(summary.ok).toBe(true);

    const state = await passState();
    expect(state.auto_renew_status, "a real decline must still lapse").toBe("lapsed");
    expect(state.auto_renew).toBe(false);
    expect(state.next_renewal_date).toBeNull();

    const txns = await transactionsForPass();
    expect(txns.map((t) => t.status)).toEqual(["failed"]);
  });

  it("Paystack answered with a non-success status: also lapses", async () => {
    charge.mockResolvedValue({
      status: "failed",
      reference: "ref_decline",
      amount: 100,
      channel: "card",
      gateway_response: "Declined by financial institution",
    });

    const { runPassRenewalJob } = await import("@/lib/billing/renewals");
    await runPassRenewalJob();

    expect((await passState()).auto_renew_status).toBe("lapsed");
  });
});

describe("an indeterminate failure must NOT end the subscription", () => {
  it("a timeout leaves the Pass renewable and retries on the next run", async () => {
    /*
     * THE BUG. Against the unfixed code this fails with
     * auto_renew_status = 'lapsed' — byte-identical handling to the genuine
     * decline above, for a failure Talentrah cannot attribute to the customer.
     */
    charge.mockRejectedValue(timeoutError());

    const { runPassRenewalJob } = await import("@/lib/billing/renewals");
    const summary = await runPassRenewalJob();

    const state = await passState();
    expect(
      state.auto_renew_status,
      "SUBSCRIPTION KILLED BY A NETWORK BLIP: a timeout lapsed a paying customer's Pass",
    ).toBe("active");
    expect(state.auto_renew, "auto-renew must stay on").toBe(true);
    expect(
      state.next_renewal_date,
      "next_renewal_date must survive — nulling it means the job never looks at this Pass again",
    ).not.toBeNull();
    expect(state.authorization_code, "the reusable token must not be discarded").toBe(
      "AUTH_test_reusable_code",
    );
    expect(summary.lapsed, "an unattributable failure is not a lapse").toBe(0);
  });

  it("does not record 'failed' for a charge that may have succeeded", async () => {
    /*
     * The subtler half. On a timeout Paystack may already have debited the
     * card. Writing `status: 'failed'` asserts something we cannot know, and it
     * is the record a human would later use to decide whether the customer was
     * charged.
     */
    charge.mockRejectedValue(timeoutError());

    const { runPassRenewalJob } = await import("@/lib/billing/renewals");
    await runPassRenewalJob();

    const txns = await transactionsForPass();
    expect(txns, "the attempt should still be recorded — it may need reconciling").toHaveLength(1);
    expect(
      txns[0].status,
      "UNSUPPORTABLE CLAIM: recorded 'failed' for a charge Paystack may have completed",
    ).toBe("pending");
  });

  it("a repeated indeterminate failure eventually lapses rather than retrying forever", async () => {
    // The other side of the policy: "never lapse on a timeout" would leave a
    // Pass promising renewal indefinitely against an endpoint that never
    // answers. Bounded, not infinite.
    const { MAX_INDETERMINATE_RENEWAL_ATTEMPTS } = await import("@/lib/billing/renewals");
    charge.mockRejectedValue(timeoutError());
    verify.mockRejectedValue(timeoutError());

    const { runPassRenewalJob } = await import("@/lib/billing/renewals");
    for (let i = 0; i < MAX_INDETERMINATE_RENEWAL_ATTEMPTS; i++) {
      await runPassRenewalJob();
    }

    const state = await passState();
    expect(
      state.auto_renew_status,
      `after ${MAX_INDETERMINATE_RENEWAL_ATTEMPTS} unanswered attempts the Pass should finally lapse`,
    ).toBe("lapsed");
  });

  it("when it finally gives up, it leaves the trail back to the money", async () => {
    /*
     * The one genuinely bad outcome this design cannot rule out: we stop
     * retrying while a charge of unknown outcome is outstanding, so the
     * customer may have been debited and lapsed anyway. Nothing can resolve
     * that automatically — Paystack never answered, three times.
     *
     * What CAN be guaranteed is that the evidence survives. Clearing
     * `pending_renewal_reference` to leave a tidy row, or "correcting" the
     * transaction to `failed`, would destroy the only thread back to a refund
     * someone may be owed.
     */
    const { MAX_INDETERMINATE_RENEWAL_ATTEMPTS } = await import("@/lib/billing/renewals");
    charge.mockRejectedValue(timeoutError());
    verify.mockRejectedValue(timeoutError());

    const { runPassRenewalJob } = await import("@/lib/billing/renewals");
    let summary;
    for (let i = 0; i < MAX_INDETERMINATE_RENEWAL_ATTEMPTS; i++) {
      summary = await runPassRenewalJob();
    }

    const { data: state } = await admin
      .from("user_passes")
      .select("auto_renew_status, pending_renewal_reference, renewal_attempt_count")
      .eq("id", userPassId)
      .single();

    expect(state!.auto_renew_status).toBe("lapsed");
    expect(
      state!.pending_renewal_reference,
      "the reference must survive the lapse — it is the only thread back to a possible charge",
    ).not.toBeNull();

    const txns = await transactionsForPass();
    expect(
      txns.every((x) => x.status === "pending"),
      "an unresolved charge must never be retroactively relabelled 'failed'",
    ).toBe(true);

    expect(
      summary!.errors.some((e) => e.message.includes("NEEDS RECONCILIATION")),
      "the run must say out loud that a human has to reconcile this",
    ).toBe(true);
  });

  it("a retry verifies the previous attempt before charging again", async () => {
    /*
     * Double-charge prevention. If the first attempt timed out AFTER Paystack
     * processed it, charging again bills the customer twice for one period —
     * strictly worse than the bug being fixed.
     */
    charge.mockRejectedValueOnce(timeoutError());
    const { runPassRenewalJob } = await import("@/lib/billing/renewals");
    await runPassRenewalJob();

    const pendingRef = (await transactionsForPass())[0].paystack_reference;

    // Second run: Paystack now says that reference actually succeeded.
    verify.mockResolvedValue({
      status: "success",
      reference: pendingRef,
      amount: 100,
      channel: "card",
    });
    await runPassRenewalJob();

    expect(verify, "the pending reference must be verified before re-charging").toHaveBeenCalledWith(
      pendingRef,
    );
    expect(charge, "must NOT charge again when the first attempt actually succeeded").toHaveBeenCalledTimes(1);

    const state = await passState();
    expect(state.auto_renew_status).toBe("active");
    const txns = await transactionsForPass();
    expect(txns.filter((t) => t.status === "success"), "the recovered charge is recorded once").toHaveLength(1);
  });
});
