/**
 * "Credit spend for human-reviewed verification is race-safe under
 * concurrent attempts" — the same bar 0135's own verification-race.test.ts
 * already holds the AI-only tier to, applied to the new higher-cost
 * `talent_directory_human_review` credit_reason (0141/0142).
 *
 * Same two layers, for the same reasons:
 *  1. The CLAIM step (`profiles.talent_verification_status IN
 *     ('unverified','rejected') -> 'pending'`) is unchanged from the AI path
 *     — runTalentVerificationHumanReview reuses the exact same conditional
 *     UPDATE, so two concurrent requests can only ever have one succeed at
 *     claiming 'pending' regardless of which tier they're requesting.
 *  2. spendCredits' own atomic RPC (0035) is proven generically by
 *     spend-race.test.ts; this suite confirms the NEW credit_reason value
 *     routes through it, matching verification-race.test.ts's own
 *     "each call site" pattern.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import { spendCredits, InsufficientCreditsError } from "@/lib/credits/spend";
import { CREDIT_COSTS } from "@/lib/credits/costs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Human review race test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let userId: string;

beforeAll(async () => {
  const user = await createTestUser("human-review-race");
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

afterEach(async () => {
  await admin.from("talent_verifications").delete().eq("user_id", userId);
  await admin
    .from("profiles")
    .update({ talent_verification_status: "unverified", talent_verification_score: null, talent_verified_at: null })
    .eq("id", userId);
});

async function verificationStatus(): Promise<string> {
  const { data } = await admin.from("profiles").select("talent_verification_status").eq("id", userId).single();
  return data!.talent_verification_status;
}

describe("the claim step: two concurrent human-review requests, exactly one proceeds", () => {
  it("the second concurrent claim is refused before it can double-spend credits", async () => {
    await setBalance(CREDIT_COSTS.talentDirectoryHumanReview);

    const { runTalentVerificationHumanReview } = await import("@/lib/talent-directory/verification-runner");
    const [a, b] = await Promise.all([
      runTalentVerificationHumanReview(userId),
      runTalentVerificationHumanReview(userId),
    ]);

    const outcomes = [a.status, b.status];
    expect(
      outcomes.filter((s) => s === "success").length,
      "MONEY BUG: two concurrent human-review requests both proceeded — credits could be spent twice for one attempt",
    ).toBe(1);
    expect(outcomes.filter((s) => s === "error").length).toBe(1);

    const loser = a.status === "error" ? a : b;
    expect(loser.message).toMatch(/already pending|already verified/i);

    const { count } = await admin
      .from("talent_verifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    expect(count, "MONEY BUG: a second human-review row was created by the losing request").toBe(1);
  });

  it("queues a row with review_type='human' and status='pending', unclaimed", async () => {
    await setBalance(CREDIT_COSTS.talentDirectoryHumanReview);

    const { runTalentVerificationHumanReview } = await import("@/lib/talent-directory/verification-runner");
    const result = await runTalentVerificationHumanReview(userId, "Backend Engineer", "Fintech");

    expect(result.status).toBe("success");

    const { data: row } = await admin
      .from("talent_verifications")
      .select("review_type, status, reviewer_id, target_role, target_industry")
      .eq("user_id", userId)
      .single();

    expect(row?.review_type).toBe("human");
    expect(row?.status).toBe("pending");
    expect(row?.reviewer_id).toBeNull();
    expect(row?.target_role).toBe("Backend Engineer");
    expect(row?.target_industry).toBe("Fintech");
  });

  it("an insufficient balance releases the claim so a real retry is possible", async () => {
    await setBalance(0);

    const { runTalentVerificationHumanReview } = await import("@/lib/talent-directory/verification-runner");
    const result = await runTalentVerificationHumanReview(userId);

    expect(result.status).toBe("error");
    expect(
      await verificationStatus(),
      "an insufficient-balance human-review request must release the claim back to unverified",
    ).toBe("unverified");

    const { count } = await admin
      .from("talent_verifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    expect(count, "a released claim must not leave an orphaned pending row").toBe(0);
  });
});

describe("the talent_directory_human_review credit_reason routes through spendCredits' own atomic RPC", () => {
  it("two concurrent spends at balance == cost yield exactly one charge (0035's own guarantee, confirmed for this reason)", async () => {
    const cost = CREDIT_COSTS.talentDirectoryHumanReview;
    await admin.from("credit_ledger").delete().eq("user_id", userId);
    await admin.from("credit_ledger").insert({
      user_id: userId,
      delta: cost,
      reason: "admin_adjustment",
      balance_after: cost,
    });

    const results = await Promise.allSettled([
      spendCredits(userId, cost, "talent_directory_human_review"),
      spendCredits(userId, cost, "talent_directory_human_review"),
    ]);

    expect(
      results.filter((r) => r.status === "fulfilled").length,
      `MONEY: talent_directory_human_review double-charged at the boundary`,
    ).toBe(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason,
    ).toBeInstanceOf(InsufficientCreditsError);

    const { data: profile } = await admin.from("profiles").select("credits_balance").eq("id", userId).single();
    expect(profile?.credits_balance).toBe(0);
  });
});
