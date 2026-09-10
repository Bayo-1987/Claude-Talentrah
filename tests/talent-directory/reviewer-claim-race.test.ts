/**
 * The reviewer-assignment mechanism's own concurrency guard (0141/0142,
 * design decision 2: reviewer-picks-from-a-pool). Same atomic
 * "conditional UPDATE ... WHERE" idiom already proven for
 * auto_apply_claim_submission (0034) and book_mentor_session's own slot
 * lock (0133) — this suite proves it holds for
 * claim_talent_verification_review too, rather than assuming it from the
 * shape of the SQL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import {
  claimVerificationReview,
  releaseVerificationReviewClaim,
  resolveVerificationReview,
} from "@/lib/talent-directory/reviewer-runner";
import { CREDIT_COSTS } from "@/lib/credits/costs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Reviewer claim race test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let candidateId: string;
let reviewerAId: string;
let reviewerBId: string;
let unapprovedReviewerId: string;
let notOptedInReviewerId: string;

beforeAll(async () => {
  const [candidate, reviewerA, reviewerB, unapproved, notOptedIn] = await Promise.all([
    createTestUser("reviewer-race-candidate"),
    createTestUser("reviewer-race-a"),
    createTestUser("reviewer-race-b"),
    createTestUser("reviewer-race-unapproved"),
    createTestUser("reviewer-race-not-opted-in"),
  ]);
  candidateId = candidate.id;
  reviewerAId = reviewerA.id;
  reviewerBId = reviewerB.id;
  unapprovedReviewerId = unapproved.id;
  notOptedInReviewerId = notOptedIn.id;

  const { error } = await admin.from("mentor_profiles").insert([
    { user_id: reviewerAId, status: "approved", reviews_verifications: true },
    { user_id: reviewerBId, status: "approved", reviews_verifications: true },
    { user_id: unapprovedReviewerId, status: "pending", reviews_verifications: true },
    { user_id: notOptedInReviewerId, status: "approved", reviews_verifications: false },
  ]);
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await admin
    .from("mentor_profiles")
    .delete()
    .in("user_id", [reviewerAId, reviewerBId, unapprovedReviewerId, notOptedInReviewerId]);
  await deleteTestUsers([candidateId, reviewerAId, reviewerBId, unapprovedReviewerId, notOptedInReviewerId]);
}, 60_000);

/**
 * Each test queues its own fresh submission — leftover rows from a PRIOR
 * test in this same file are deleted first, so the `.single()` read below
 * can't collide with them (a stale multi-row leftover made this return null
 * and fail every test after the first with a confusing "Cannot read
 * properties of null" until this cleanup was added).
 */
async function queueOneSubmission(): Promise<string> {
  await admin.from("talent_verifications").delete().eq("user_id", candidateId);
  await admin.from("credit_ledger").insert({
    user_id: candidateId,
    delta: CREDIT_COSTS.talentDirectoryHumanReview,
    reason: "admin_adjustment",
    balance_after: CREDIT_COSTS.talentDirectoryHumanReview,
  });
  await admin.from("profiles").update({ talent_verification_status: "unverified" }).eq("id", candidateId);

  const { runTalentVerificationHumanReview } = await import("@/lib/talent-directory/verification-runner");
  const result = await runTalentVerificationHumanReview(candidateId, "Product Manager", "Fintech");
  expect(result.status).toBe("success");

  const { data } = await admin
    .from("talent_verifications")
    .select("id")
    .eq("user_id", candidateId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .single();
  return data!.id;
}

describe("claim_talent_verification_review's atomic pick step", () => {
  it("two reviewers racing for the same submission: exactly one claims it", async () => {
    const verificationId = await queueOneSubmission();

    const [a, b] = await Promise.all([
      claimVerificationReview(reviewerAId, verificationId),
      claimVerificationReview(reviewerBId, verificationId),
    ]);

    const outcomes = [a.ok, b.ok];
    expect(outcomes.filter(Boolean).length, "RACE BUG: two reviewers both claimed the same submission").toBe(1);

    const loser = a.ok ? b : a;
    expect(loser.reason).toBe("ALREADY_CLAIMED");

    const { data: row } = await admin
      .from("talent_verifications")
      .select("status, reviewer_id")
      .eq("id", verificationId)
      .single();
    expect(row?.status).toBe("claimed");
    expect([reviewerAId, reviewerBId]).toContain(row?.reviewer_id);
  });

  it("rejects a claim from a reviewer who isn't approved", async () => {
    const verificationId = await queueOneSubmission();
    const result = await claimVerificationReview(unapprovedReviewerId, verificationId);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("NOT_ELIGIBLE_REVIEWER");
  });

  it("rejects a claim from an approved mentor who has NOT opted in to reviewing", async () => {
    const verificationId = await queueOneSubmission();
    const result = await claimVerificationReview(notOptedInReviewerId, verificationId);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("NOT_ELIGIBLE_REVIEWER");
  });

  it("rejects a candidate reviewing their own submission, even if they are also an eligible mentor", async () => {
    await admin.from("mentor_profiles").insert({ user_id: candidateId, status: "approved", reviews_verifications: true });
    try {
      const verificationId = await queueOneSubmission();
      const result = await claimVerificationReview(candidateId, verificationId);
      expect(result.ok, "DUAL-ROLE BUG: a candidate was allowed to review their own submission").toBe(false);
      expect(result.reason).toBe("CANNOT_REVIEW_OWN_SUBMISSION");
    } finally {
      await admin.from("mentor_profiles").delete().eq("user_id", candidateId);
    }
  });

  it("release returns an item to the pool, claimable by someone else", async () => {
    const verificationId = await queueOneSubmission();

    const claimed = await claimVerificationReview(reviewerAId, verificationId);
    expect(claimed.ok).toBe(true);

    const released = await releaseVerificationReviewClaim(reviewerAId, verificationId);
    expect(released).toBe(true);

    const { data: row } = await admin
      .from("talent_verifications")
      .select("status, reviewer_id")
      .eq("id", verificationId)
      .single();
    expect(row?.status).toBe("pending");
    expect(row?.reviewer_id).toBeNull();

    const reclaimed = await claimVerificationReview(reviewerBId, verificationId);
    expect(reclaimed.ok).toBe(true);
  });

  it("a reviewer cannot release a claim they don't hold", async () => {
    const verificationId = await queueOneSubmission();
    const claimed = await claimVerificationReview(reviewerAId, verificationId);
    expect(claimed.ok).toBe(true);

    const released = await releaseVerificationReviewClaim(reviewerBId, verificationId);
    expect(released, "a non-holder must not be able to release someone else's claim").toBe(false);

    const { data: row } = await admin.from("talent_verifications").select("reviewer_id").eq("id", verificationId).single();
    expect(row?.reviewer_id).toBe(reviewerAId);
  });
});

describe("resolveVerificationReview: the human-review decision path", () => {
  it("records the decision, the reviewer's notes, and a nonzero payout, and updates the candidate's profile", async () => {
    const verificationId = await queueOneSubmission();
    const claimed = await claimVerificationReview(reviewerAId, verificationId);
    expect(claimed.ok).toBe(true);

    const result = await resolveVerificationReview(reviewerAId, verificationId, candidateId, true, "Solid, specific resume.");
    expect(result.status).toBe("success");

    const { data: row } = await admin
      .from("talent_verifications")
      .select("status, reviewer_notes, reviewer_payout_ngn, decided_at")
      .eq("id", verificationId)
      .single();
    expect(row?.status).toBe("verified");
    expect(row?.reviewer_notes).toBe("Solid, specific resume.");
    expect(row?.reviewer_payout_ngn, "MONEY BUG: a human-reviewed decision recorded no reviewer payout").toBeGreaterThan(0);
    expect(row?.decided_at).not.toBeNull();

    const { data: profile } = await admin
      .from("profiles")
      .select("talent_verification_status, talent_verified_at")
      .eq("id", candidateId)
      .single();
    expect(profile?.talent_verification_status).toBe("verified");
    expect(profile?.talent_verified_at).not.toBeNull();
  });

  it("refuses to resolve a submission the caller doesn't currently hold the claim on", async () => {
    const verificationId = await queueOneSubmission();
    const claimed = await claimVerificationReview(reviewerAId, verificationId);
    expect(claimed.ok).toBe(true);

    // reviewerB never claimed this one.
    const result = await resolveVerificationReview(reviewerBId, verificationId, candidateId, true, "not my claim");
    expect(result.status).toBe("error");

    const { data: row } = await admin.from("talent_verifications").select("status").eq("id", verificationId).single();
    expect(row?.status, "a non-holder must not be able to resolve someone else's claim").toBe("claimed");
  });
});
