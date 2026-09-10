/**
 * resolve_talent_verification (0142) hardcodes the reviewer payout formula
 * as a SQL literal rather than accepting it as a caller-supplied parameter —
 * see that migration's own header for why (the same "computed inside the
 * one atomic statement, never trusted from the caller" reasoning
 * book_mentor_session (0133) already established for session pricing).
 * That means the formula is duplicated in two places by design:
 *   - SQL: round(60 * 125 * 0.85)   (0142)
 *   - TS:  CREDIT_COSTS.talentDirectoryHumanReview * 125 * 0.85
 * This is the test that actually proves the two haven't silently drifted
 * apart — the same role tests/mentorship/commission-split.test.ts already
 * plays for 0133's own duplicated pricing formula.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import { claimVerificationReview, resolveVerificationReview } from "@/lib/talent-directory/reviewer-runner";
import { CREDIT_COSTS } from "@/lib/credits/costs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Reviewer payout test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** MUST match resolve_talent_verification's own literals (0142's header). */
const NGN_PER_CREDIT = 125;
const REVIEWER_PAYOUT_RATE = 0.85;

let candidateId: string;
let reviewerId: string;

beforeAll(async () => {
  const [candidate, reviewer] = await Promise.all([
    createTestUser("reviewer-payout-candidate"),
    createTestUser("reviewer-payout-reviewer"),
  ]);
  candidateId = candidate.id;
  reviewerId = reviewer.id;

  const { error } = await admin
    .from("mentor_profiles")
    .insert({ user_id: reviewerId, status: "approved", reviews_verifications: true });
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await admin.from("mentor_profiles").delete().eq("user_id", reviewerId);
  await deleteTestUsers([candidateId, reviewerId]);
}, 60_000);

it("the recorded reviewer payout matches CREDIT_COSTS.talentDirectoryHumanReview * NGN_PER_CREDIT * REVIEWER_PAYOUT_RATE, rounded", async () => {
  const expectedPayout = Math.round(CREDIT_COSTS.talentDirectoryHumanReview * NGN_PER_CREDIT * REVIEWER_PAYOUT_RATE);
  // Pinned to the number 0142's own header states explicitly (₦6,375) so a
  // change to either side's constants without updating the other is caught
  // even if this test's own formula were copy-pasted wrong from the same
  // source as the bug.
  expect(expectedPayout).toBe(6_375);

  await admin.from("credit_ledger").insert({
    user_id: candidateId,
    delta: CREDIT_COSTS.talentDirectoryHumanReview,
    reason: "admin_adjustment",
    balance_after: CREDIT_COSTS.talentDirectoryHumanReview,
  });
  await admin.from("profiles").update({ talent_verification_status: "unverified" }).eq("id", candidateId);

  const { runTalentVerificationHumanReview } = await import("@/lib/talent-directory/verification-runner");
  const requested = await runTalentVerificationHumanReview(candidateId);
  expect(requested.status).toBe("success");

  const { data: verification } = await admin
    .from("talent_verifications")
    .select("id")
    .eq("user_id", candidateId)
    .single();
  const verificationId = verification!.id;

  const claimed = await claimVerificationReview(reviewerId, verificationId);
  expect(claimed.ok).toBe(true);

  const resolved = await resolveVerificationReview(reviewerId, verificationId, candidateId, true, "Looks good.");
  expect(resolved.status).toBe("success");

  const { data: row } = await admin
    .from("talent_verifications")
    .select("reviewer_payout_ngn")
    .eq("id", verificationId)
    .single();
  expect(
    row?.reviewer_payout_ngn,
    "the SQL literal in resolve_talent_verification (0142) has drifted from CREDIT_COSTS.talentDirectoryHumanReview — update both together",
  ).toBe(expectedPayout);
});

it("an AI-graded verification records zero reviewer payout", async () => {
  await admin.from("talent_verifications").delete().eq("user_id", candidateId);
  await admin.from("profiles").update({ talent_verification_status: "unverified" }).eq("id", candidateId);

  const { data: verification, error } = await admin
    .from("talent_verifications")
    .insert({ user_id: candidateId, status: "pending", review_type: "ai" })
    .select("id")
    .single();
  if (error || !verification) throw error ?? new Error("no verification row");

  const { data: ok } = await admin.rpc("resolve_talent_verification", {
    p_verification_id: verification.id,
    p_user_id: candidateId,
    p_verified: true,
    p_score: 90,
    p_feedback: "Great resume.",
  });
  expect(ok).toBe(true);

  const { data: row } = await admin
    .from("talent_verifications")
    .select("reviewer_payout_ngn")
    .eq("id", verification.id)
    .single();
  expect(row?.reviewer_payout_ngn).toBe(0);
});
