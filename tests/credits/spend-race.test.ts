/**
 * The credit-spend race — the single highest-value test in this repo's
 * financial surface, written once against `spendCredits` itself.
 *
 * WHY ONE TEST AND NOT FOUR. Four features call this function: tailoring
 * (which fires the tailoring and cover-letter spends for a single request),
 * Auto-Apply's confirmation, Resume Builder's bullet rewrite, and the
 * scholarship eligibility/SOP actions. The race was identical in all four
 * because it lived in the shared function, not in any of them. Writing four
 * from-scratch race tests would have tested one bug four times; the generic
 * test below proves the property, and the per-call-site tests that follow only
 * confirm each feature actually routes through the fixed function.
 *
 * WHAT WAS BROKEN. The old implementation read the balance, compared it in JS,
 * and inserted a ledger row carrying a balance computed here — while the ledger
 * trigger writes `credits_balance = balance_after` as an ABSOLUTE overwrite.
 * Two concurrent spends both read the same start, both passed, and both wrote
 * the same result: one paid-for AI action, silently free, plus a ledger sum
 * permanently out of step with the cached balance.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { spendCredits, InsufficientCreditsError } from "@/lib/credits/spend";
import { CREDIT_COSTS } from "@/lib/credits/costs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Credit-race test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let userId: string;

async function makeUser(): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `credit-race-${randomUUID()}@talentrah.test`,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user!.id;
}

/** Sets an exact starting balance through the ledger, the way the app does. */
async function setBalance(id: string, amount: number) {
  await admin.from("credit_ledger").delete().eq("user_id", id);
  if (amount > 0) {
    await admin.from("credit_ledger").insert({
      user_id: id,
      delta: amount,
      reason: "admin_adjustment",
      balance_after: amount,
    });
  } else {
    await admin.from("profiles").update({ credits_balance: 0 }).eq("id", id);
  }
  const { data } = await admin.from("profiles").select("credits_balance").eq("id", id).single();
  expect(data?.credits_balance, "test setup failed to establish the balance").toBe(amount);
}

async function balanceOf(id: string): Promise<number> {
  const { data } = await admin.from("profiles").select("credits_balance").eq("id", id).single();
  return data?.credits_balance ?? -1;
}

async function ledgerSum(id: string): Promise<number> {
  const { data } = await admin.from("credit_ledger").select("delta").eq("user_id", id);
  return (data ?? []).reduce((sum, r) => sum + r.delta, 0);
}

beforeEach(async () => {
  userId = await makeUser();
});

afterAll(async () => {
  /*
   * Deleted in parallel, with an explicit hook timeout.
   *
   * Serially, this is one round-trip to Supabase Auth per account created by
   * the suite — one per test, eleven of them here — inside vitest's default 10s hook budget. It
   * fit until it didn't: a slow afternoon against the live project blew the
   * budget and the whole FILE was reported as failed while all 11 of its
   * tests had passed. Worse, the timeout aborts the loop partway, so it leaks
   * exactly the throwaway accounts it exists to remove — into the shared
   * project, because there is no staging database.
   */
  const { data } = await admin.auth.admin.listUsers();
  const mine = data.users.filter((x) => x.email?.startsWith("credit-race-"));
  await Promise.all(mine.map((u) => admin.auth.admin.deleteUser(u.id)));
}, 60_000);

describe("spendCredits is atomic", () => {
  it("two concurrent spends at balance == cost: exactly one succeeds", async () => {
    /*
     * The core assertion. Proven to catch the bug: against the old
     * read-then-write implementation this fails with two fulfilled promises
     * and a balance of 0 after 10 credits of spending — i.e. one spend free.
     */
    const COST = 5;
    await setBalance(userId, COST);

    const results = await Promise.allSettled([
      spendCredits(userId, COST, "tailoring_run"),
      spendCredits(userId, COST, "tailoring_run"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(
      fulfilled.length,
      "MONEY: both concurrent spends succeeded — one AI action was performed and paid for by nobody",
    ).toBe(1);
    expect(rejected.length).toBe(1);
    expect(
      (rejected[0] as PromiseRejectedResult).reason,
      "the loser must fail cleanly, not with a raw database error",
    ).toBeInstanceOf(InsufficientCreditsError);

    expect(await balanceOf(userId), "exactly one spend should have been deducted").toBe(0);
    expect(
      await ledgerSum(userId),
      "the ledger must still reconcile with the cached balance",
    ).toBe(0);
  });

  it("ten concurrent spends against a balance that affords three: exactly three succeed", async () => {
    // A double-click is two; a queue of buttons is ten. The property has to
    // hold at width, not just for a pair.
    const COST = 2;
    await setBalance(userId, COST * 3);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => spendCredits(userId, COST, "bullet_rewrite")),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;

    expect(ok, `CAP BREACH: ${ok} of 10 concurrent spends got through a balance affording 3`).toBe(3);
    expect(await balanceOf(userId)).toBe(0);
    expect(await ledgerSum(userId)).toBe(0);
  });

  it("no lost decrement: concurrent spends the balance CAN afford all land", async () => {
    /*
     * The other half, and the one a naive lock could break. The old bug had two
     * faces — a double spend at the boundary, and a LOST decrement when both
     * succeeded but only one deduction stuck. This asserts the second is gone
     * too: four affordable spends must remove four costs, not one.
     */
    const COST = 2;
    await setBalance(userId, 20);

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => spendCredits(userId, COST, "bullet_rewrite")),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    expect(await balanceOf(userId), "a decrement was lost to a concurrent write").toBe(
      20 - COST * 4,
    );
    expect(await ledgerSum(userId)).toBe(20 - COST * 4);
  });

  it("sequential spends still work, and a genuine shortfall still refuses", async () => {
    // Positive control: every assertion above is satisfied by a function that
    // refuses everything.
    await setBalance(userId, 6);
    expect(await spendCredits(userId, 4, "tailoring_run")).toBe(2);
    await expect(spendCredits(userId, 4, "tailoring_run")).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(await balanceOf(userId)).toBe(2);
  });

  it("refuses a non-positive amount rather than treating it as a grant", async () => {
    await setBalance(userId, 5);
    await expect(spendCredits(userId, 0, "tailoring_run")).rejects.toThrow();
    await expect(spendCredits(userId, -10, "tailoring_run")).rejects.toThrow();
    expect(await balanceOf(userId), "a negative spend must not top the account up").toBe(5);
  });
});

describe("each call site routes through the fixed function", () => {
  /*
   * Thin by design. The race property is proven above; these only confirm that
   * each feature's real cost constant goes through the same path and produces
   * the same one-winner outcome — so a future refactor that reintroduces a
   * bespoke spend in one feature fails here.
   */
  const callSites = [
    ["tailoring", CREDIT_COSTS.tailoringRun, "tailoring_run"],
    ["cover letter", CREDIT_COSTS.coverLetterRun, "cover_letter_run"],
    ["resume builder bullet rewrite", CREDIT_COSTS.bulletRewrite, "bullet_rewrite"],
    ["auto-apply", CREDIT_COSTS.autoApplySubmission, "auto_apply_run"],
    ["scholarship eligibility", CREDIT_COSTS.scholarshipEligibilityCheck, "scholarship_eligibility_check"],
    ["scholarship SOP", CREDIT_COSTS.scholarshipSopDraft, "scholarship_sop_draft"],
  ] as const;

  for (const [label, cost, reason] of callSites) {
    it(`${label}: two concurrent spends at balance == cost yield exactly one charge`, async () => {
      await setBalance(userId, cost);

      const results = await Promise.allSettled([
        spendCredits(userId, cost, reason),
        spendCredits(userId, cost, reason),
      ]);

      expect(
        results.filter((r) => r.status === "fulfilled").length,
        `MONEY: ${label} double-charged or double-served at the boundary`,
      ).toBe(1);
      expect(await balanceOf(userId)).toBe(0);

      const { data: rows } = await admin
        .from("credit_ledger")
        .select("reason, delta")
        .eq("user_id", userId)
        .eq("reason", reason);
      expect(rows ?? [], "exactly one ledger row should record the charge").toHaveLength(1);
      expect(rows?.[0]?.delta).toBe(-cost);
    });
  }
});
