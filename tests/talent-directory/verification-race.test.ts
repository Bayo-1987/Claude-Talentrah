/**
 * "Credit spend for verification is race-safe under concurrent attempts"
 * (send-139's own explicit requirement, same bar as spend-race.test.ts).
 *
 * Two layers, matching the two atomicity primitives runTalentVerification
 * actually leans on:
 *  1. The CLAIM step (`profiles.talent_verification_status IN
 *     ('unverified','rejected') -> 'pending'`, a plain conditional UPDATE) is
 *     the real concurrency guard for THIS feature specifically — two
 *     concurrent requests can only ever have one succeed at claiming
 *     'pending'; the loser is refused before it ever reaches the LLM call or
 *     spendCredits, so a double-click can never spend credits twice for one
 *     logical verification.
 *  2. spendCredits' own atomic RPC (0035) is proven generically by
 *     spend-race.test.ts and inherited here "for free" — this suite adds one
 *     thin confirmation that the real credit_reason routes through it
 *     (matching spend-race.test.ts's own "each call site" pattern), not a
 *     second full proof of the underlying primitive.
 *
 * The LLM call itself is mocked (gradeResumeForVerification) — there is no
 * way to make a real model call deterministic across a race, and it is not
 * what this suite is testing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import { spendCredits, InsufficientCreditsError } from "@/lib/credits/spend";
import { CREDIT_COSTS } from "@/lib/credits/costs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Talent verification race test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const grade = vi.hoisted(() => vi.fn());
vi.mock("@/lib/talent-directory/verification", () => ({
  gradeResumeForVerification: grade,
  VERIFICATION_PASS_THRESHOLD: 70,
}));

let userId: string;

beforeAll(async () => {
  const user = await createTestUser("verification-race");
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
  grade.mockReset();
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

describe("the claim step: two concurrent verification requests, exactly one proceeds", () => {
  it("the second concurrent claim is refused before it can double-spend credits", async () => {
    // Enough for exactly one successful verification (not two) — if the
    // claim step failed to gate the race, this balance is also what would
    // expose a double-spend as a second successful charge rather than
    // masking it behind an insufficient-credits error.
    await setBalance(CREDIT_COSTS.talentDirectoryVerification);
    grade.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ score: 80, passed: true, feedback: "", concerns: [] }), 50)));

    const { runTalentVerification } = await import("@/lib/talent-directory/verification-runner");
    const [a, b] = await Promise.all([runTalentVerification(userId), runTalentVerification(userId)]);

    const outcomes = [a.status, b.status];
    expect(
      outcomes.filter((s) => s === "success").length,
      "MONEY BUG: two concurrent verification requests both proceeded — credits could be spent twice for one attempt",
    ).toBe(1);
    expect(outcomes.filter((s) => s === "error").length).toBe(1);

    const loser = a.status === "error" ? a : b;
    expect(loser.message).toMatch(/already pending|already verified/i);

    // Exactly one talent_verifications row was ever created for this race.
    const { count } = await admin
      .from("talent_verifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    expect(count, "MONEY BUG: a second verification attempt row was created by the losing request").toBe(1);
  });

  it("a claim attempt while ALREADY verified is refused outright", async () => {
    await admin
      .from("profiles")
      .update({ talent_verification_status: "verified", talent_verification_score: 90 })
      .eq("id", userId);

    const { runTalentVerification } = await import("@/lib/talent-directory/verification-runner");
    const result = await runTalentVerification(userId);

    expect(result.status).toBe("error");
    expect(grade, "an already-verified user's request must never reach the LLM").not.toHaveBeenCalled();
    expect(await verificationStatus()).toBe("verified");
  });

  it("a failed grading attempt releases the claim so a real retry is possible", async () => {
    // Sufficient balance, deliberately — this test is specifically about the
    // LLM-failure release path, not the insufficient-credits one (which
    // shares the same release code but is a different failure to prove).
    await setBalance(CREDIT_COSTS.talentDirectoryVerification);
    grade.mockRejectedValue(new Error("LLM unavailable"));

    const { runTalentVerification } = await import("@/lib/talent-directory/verification-runner");
    const result = await runTalentVerification(userId);

    expect(result.status).toBe("error");
    expect(
      await verificationStatus(),
      "a failed grading attempt must release the claim back to unverified, not leave it stuck pending",
    ).toBe("unverified");

    const { count } = await admin
      .from("talent_verifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    expect(count, "a released claim must not leave an orphaned pending row").toBe(0);
  });
});

describe("the credit_reason routes through spendCredits' own atomic RPC", () => {
  it("two concurrent spends at balance == cost yield exactly one charge (0035's own guarantee, confirmed for this reason)", async () => {
    const cost = CREDIT_COSTS.talentDirectoryVerification;
    await admin.from("credit_ledger").delete().eq("user_id", userId);
    await admin.from("credit_ledger").insert({
      user_id: userId,
      delta: cost,
      reason: "admin_adjustment",
      balance_after: cost,
    });

    const results = await Promise.allSettled([
      spendCredits(userId, cost, "talent_directory_verification"),
      spendCredits(userId, cost, "talent_directory_verification"),
    ]);

    expect(
      results.filter((r) => r.status === "fulfilled").length,
      `MONEY: talent_directory_verification double-charged at the boundary`,
    ).toBe(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason,
    ).toBeInstanceOf(InsufficientCreditsError);

    const { data: profile } = await admin.from("profiles").select("credits_balance").eq("id", userId).single();
    expect(profile?.credits_balance).toBe(0);
  });
});
