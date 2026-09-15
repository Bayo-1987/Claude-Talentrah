/**
 * The credit-GRANT race — the mirror image of tests/credits/spend-race.test.ts,
 * on the two real mechanisms that ever grant credits: grantCredits() itself
 * and grant_referral_reward() (the actual live caller behind referral
 * signup/activation bonuses).
 *
 * WHAT WAS BROKEN, IN BOTH. Same trigger-overwrite shape as pre-0035
 * spendCredits: read profiles.credits_balance, add the grant amount in
 * JS/PL-pgSQL, insert a credit_ledger row carrying that computed
 * balance_after — while apply_credit_ledger_entry's trigger performs an
 * ABSOLUTE overwrite of credits_balance from whatever balance_after it's
 * given. Two concurrent grants to the same user both read the same starting
 * balance and one grant's write clobbers the other's: a lost grant, silently.
 *
 * grantCredits() itself has NO live callers today (fulfill.ts's credit_pack
 * branch — its only caller — was fixed in 0159 to call
 * fulfill_credit_pack_or_pass() directly instead), confirmed by grepping the
 * whole src/ tree rather than assumed from the task description. The real
 * caller for "referral payout landing near another grant" is
 * grant_referral_reward() (0015), invoked from handle_new_user() (signup
 * bonus) and check_and_activate_referral() (activation bonus) — it has the
 * identical bug, inline in PL/pgSQL, found by reading its body rather than
 * trusting its name. Both are fixed here by routing through the same
 * grant_credits_atomic() (0159/0160) — a single RELATIVE UPDATE
 * (credits_balance = credits_balance + p_amount) under the row's own lock.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { grantCredits } from "@/lib/credits/spend";
import { listUsersWithPrefix, RUN_TAG } from "../support/list-users";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Credit-grant-race test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function makeUser(): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `credit-grant-race-${RUN_TAG}-${randomUUID()}@talentrah.test`,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user!.id;
}

async function setBalance(id: string, amount: number) {
  await admin.from("credit_ledger").delete().eq("user_id", id);
  await admin.from("profiles").update({ credits_balance: amount }).eq("id", id);
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

afterAll(async () => {
  const mine = await listUsersWithPrefix(admin, `credit-grant-race-${RUN_TAG}-`);
  await Promise.all(mine.map((u) => admin.auth.admin.deleteUser(u.id)));
}, 60_000);

describe("grantCredits is atomic", () => {
  let userId: string;
  beforeEach(async () => {
    userId = await makeUser();
  });

  it("two concurrent grants to the same user: neither is lost", async () => {
    /*
     * Proven to catch the bug: against the old read-then-write
     * implementation this fails with a final balance of 10 (one grant
     * clobbered by the other) instead of 20.
     */
    await setBalance(userId, 0);

    const results = await Promise.allSettled([
      grantCredits(userId, 10, "admin_adjustment"),
      grantCredits(userId, 10, "admin_adjustment"),
    ]);

    expect(results.every((r) => r.status === "fulfilled"), "both grants should succeed").toBe(true);
    expect(await balanceOf(userId), "MONEY-ADJACENT BUG: a grant was lost to a concurrent write").toBe(20);
    expect(await ledgerSum(userId), "the ledger must still reconcile with the cached balance").toBe(20);

    const { count } = await admin
      .from("credit_ledger")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    expect(count, "both grants must each leave their own ledger row").toBe(2);
  });

  it("ten concurrent grants to the same user: all ten land", async () => {
    await setBalance(userId, 0);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => grantCredits(userId, 5, "admin_adjustment")),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await balanceOf(userId), "one or more of 10 concurrent grants was lost").toBe(50);
    expect(await ledgerSum(userId)).toBe(50);
  });

  it("sequential grants still work, and return the running balance", async () => {
    // Positive control.
    await setBalance(userId, 3);
    expect(await grantCredits(userId, 4, "admin_adjustment")).toBe(7);
    expect(await grantCredits(userId, 1, "admin_adjustment")).toBe(8);
    expect(await balanceOf(userId)).toBe(8);
  });

  it("refuses a non-positive amount rather than treating it as a spend", async () => {
    await setBalance(userId, 5);
    await expect(grantCredits(userId, 0, "admin_adjustment")).rejects.toThrow();
    await expect(grantCredits(userId, -10, "admin_adjustment")).rejects.toThrow();
    expect(await balanceOf(userId), "a negative grant must not silently debit the account").toBe(5);
  });
});

describe("grant_referral_reward is atomic — the real caller behind referral bonuses", () => {
  let referrerId: string;
  let referredA: string;
  let referredB: string;
  let referralA: string;
  let referralB: string;

  beforeEach(async () => {
    referrerId = await makeUser();
    referredA = await makeUser();
    referredB = await makeUser();
    await setBalance(referrerId, 0);

    const { data: rows, error } = await admin
      .from("referrals")
      .insert([
        { referrer_id: referrerId, referred_user_id: referredA, status: "signed_up" },
        { referrer_id: referrerId, referred_user_id: referredB, status: "signed_up" },
      ])
      .select("id");
    if (error || !rows) throw new Error(`could not create referral rows: ${error?.message}`);
    referralA = rows[0].id;
    referralB = rows[1].id;
  });

  it("two different referrals crediting the same referrer concurrently: neither reward is lost", async () => {
    /*
     * The scenario this migration exists for: two referred users completing
     * signup/activation close enough together that grant_referral_reward
     * runs for both at nearly the same time, for the SAME referrer. Proven
     * to catch the bug: against the pre-fix function this fails with a
     * final balance of 5 (one reward clobbered) instead of 10.
     */
    const results = await Promise.allSettled([
      admin.rpc("grant_referral_reward", {
        p_referral_id: referralA,
        p_referrer_id: referrerId,
        p_amount: 5,
        p_reason: "referral_signup_bonus",
      }),
      admin.rpc("grant_referral_reward", {
        p_referral_id: referralB,
        p_referrer_id: referrerId,
        p_amount: 5,
        p_reason: "referral_signup_bonus",
      }),
    ]);

    expect(results.every((r) => r.status === "fulfilled" && !r.value.error)).toBe(true);
    expect(
      await balanceOf(referrerId),
      "MONEY-ADJACENT BUG: a referral reward was lost to a concurrent grant to the same referrer",
    ).toBe(10);
    expect(await ledgerSum(referrerId)).toBe(10);

    const { data: referralRows } = await admin
      .from("referrals")
      .select("id, reward_credits_referrer")
      .in("id", [referralA, referralB]);
    for (const row of referralRows ?? []) {
      expect(row.reward_credits_referrer, `referral ${row.id} should record its own 5-credit reward`).toBe(5);
    }
  });

  it("sequential referral rewards still work", async () => {
    // Positive control.
    const first = await admin.rpc("grant_referral_reward", {
      p_referral_id: referralA,
      p_referrer_id: referrerId,
      p_amount: 5,
      p_reason: "referral_signup_bonus",
    });
    const second = await admin.rpc("grant_referral_reward", {
      p_referral_id: referralB,
      p_referrer_id: referrerId,
      p_amount: 20,
      p_reason: "referral_activation_bonus",
    });

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(await balanceOf(referrerId)).toBe(25);
  });
});
