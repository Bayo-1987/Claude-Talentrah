/**
 * "Credit spend for a directory boost is race-safe under concurrent
 * purchases" — same bar 0135's own verification-race.test.ts already holds
 * itself to, applied to 0137's boost purchase.
 *
 * Two layers, matching the two things that actually need to be atomic here
 * (see boost-runner.ts's and resolve_talent_directory_boost's own headers
 * for why these are different from verification's claim step):
 *
 *  1. spendCredits' own atomic RPC (0035) — proven generically by
 *     spend-race.test.ts, confirmed here for the new `talent_directory_boost`
 *     reason the same way verification-race.test.ts confirms its own.
 *  2. resolve_talent_directory_boost's GREATEST(...)-based extension is the
 *     part genuinely new to this feature: a plain read-then-write of
 *     `talent_boosted_until` would let two concurrent, both-successfully-
 *     charged purchases silently lose one extension. This suite proves two
 *     concurrent purchases both charge AND both extensions land — the
 *     resulting boosted_until reflects BOTH purchases' days stacked, not
 *     just one.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import { spendCredits, InsufficientCreditsError } from "@/lib/credits/spend";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { TALENT_DIRECTORY_BOOST_DAYS } from "@/lib/talent-directory/boost-constants";
import { runTalentDirectoryBoostPurchase } from "@/lib/talent-directory/boost-runner";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Talent directory boost race test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let userId: string;

beforeAll(async () => {
  const user = await createTestUser("boost-race");
  userId = user.id;
}, 60_000);

afterAll(async () => {
  await deleteTestUsers([userId]);
}, 60_000);

async function setBalance(amount: number) {
  await admin.from("credit_ledger").delete().eq("user_id", userId);
  await admin.from("credit_ledger").insert({
    user_id: userId,
    delta: amount,
    reason: "admin_adjustment",
    balance_after: amount,
  });
}

async function makeEligible() {
  await admin
    .from("profiles")
    .update({
      talent_verification_status: "verified",
      talent_directory_opt_in: true,
      talent_verified_at: new Date().toISOString(),
      talent_boosted_until: null,
    })
    .eq("id", userId);
}

afterEach(async () => {
  await admin.from("talent_directory_boosts").delete().eq("user_id", userId);
  await admin
    .from("profiles")
    .update({
      talent_verification_status: "unverified",
      talent_directory_opt_in: false,
      talent_verified_at: null,
      talent_boosted_until: null,
    })
    .eq("id", userId);
});

describe("purchasing a boost is refused before spending unless verified + opted-in", () => {
  it("an unverified user's purchase never reaches spendCredits", async () => {
    await setBalance(CREDIT_COSTS.talentDirectoryBoost * 5);
    const result = await runTalentDirectoryBoostPurchase(userId);
    expect(result.status).toBe("error");

    const { data: profile } = await admin.from("profiles").select("credits_balance").eq("id", userId).single();
    expect(profile?.credits_balance, "MONEY BUG: an ineligible purchase still spent credits").toBe(
      CREDIT_COSTS.talentDirectoryBoost * 5,
    );

    const { count } = await admin
      .from("talent_directory_boosts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    expect(count, "an ineligible purchase must not leave a boost row behind").toBe(0);
  });
});

describe("the extension itself: two concurrent purchases must both charge AND both stack", () => {
  it("two concurrent boost purchases both succeed, and the resulting boosted_until reflects BOTH purchases' days", async () => {
    await makeEligible();
    // Enough for exactly two purchases, not three — if either the spend or
    // the extension silently dropped one purchase, this balance is what
    // would expose it (a third purchase succeeding, or the final
    // talent_boosted_until only reflecting one purchase's days).
    await setBalance(CREDIT_COSTS.talentDirectoryBoost * 2);

    const before = Date.now();
    const [a, b] = await Promise.all([
      runTalentDirectoryBoostPurchase(userId),
      runTalentDirectoryBoostPurchase(userId),
    ]);

    expect(
      [a.status, b.status],
      "MONEY BUG: a concurrent boost purchase was refused even though both were affordable and eligible",
    ).toEqual(["success", "success"]);

    const { data: profile } = await admin
      .from("profiles")
      .select("credits_balance, talent_boosted_until")
      .eq("id", userId)
      .single();
    expect(profile?.credits_balance, "MONEY BUG: two successful purchases did not both charge credits").toBe(0);

    const boostedUntilMs = new Date(profile!.talent_boosted_until!).getTime();
    const minimumExpected = before + 2 * TALENT_DIRECTORY_BOOST_DAYS * 24 * 3600_000 - 5_000; // 5s slack for test runtime
    expect(
      boostedUntilMs,
      "LOST UPDATE: two concurrent purchases both charged, but talent_boosted_until only reflects ONE purchase's days — the second extension was silently overwritten",
    ).toBeGreaterThanOrEqual(minimumExpected);

    const { count } = await admin
      .from("talent_directory_boosts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "active");
    expect(count, "both purchases must be recorded as their own active audit rows").toBe(2);
  });

  it("a third purchase at the same balance boundary is refused by spendCredits' own atomic RPC (0035, confirmed for this reason)", async () => {
    await makeEligible();
    const cost = CREDIT_COSTS.talentDirectoryBoost;
    await setBalance(cost);

    const results = await Promise.allSettled([
      spendCredits(userId, cost, "talent_directory_boost"),
      spendCredits(userId, cost, "talent_directory_boost"),
    ]);

    expect(
      results.filter((r) => r.status === "fulfilled").length,
      "MONEY: talent_directory_boost double-charged at the boundary",
    ).toBe(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason,
    ).toBeInstanceOf(InsufficientCreditsError);
  });
});
