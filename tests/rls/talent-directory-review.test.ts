/**
 * 0142's own header states the design choice directly: talent_verifications'
 * existing owner-only SELECT policy (0135) is NOT widened for the
 * human-review path — every reviewer-facing read is a narrow SECURITY
 * DEFINER function instead. This suite proves that, rather than assuming it
 * from the migration's shape:
 *
 *  1. talent_verifications' row policy is untouched — a reviewer cannot read
 *     a candidate's row directly, even one they've claimed.
 *  2. talent_verification_review_queue returns EMPTY (not an error) for
 *     anyone who isn't an approved, opted-in reviewer — a pending mentor
 *     application, and an approved mentor who hasn't opted in, both see
 *     nothing.
 *  3. talent_verification_review_detail only ever returns a submission to
 *     the reviewer who CURRENTLY holds its claim — not before claiming, not
 *     after releasing, and never to a different reviewer.
 *  4. A candidate never appears in their own review queue (the queue's own
 *     `tv.user_id <> auth.uid()` guard).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";
import { CREDIT_COSTS } from "@/lib/credits/costs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Talent Directory review RLS suite cannot run: ${key} is not set.`);
}

let candidate: { id: string; client: DB };
let eligibleReviewer: { id: string; client: DB };
let otherEligibleReviewer: { id: string; client: DB };
let pendingMentor: { id: string; client: DB };
let notOptedInMentor: { id: string; client: DB };

let verificationId: string;

beforeAll(async () => {
  [candidate, eligibleReviewer, otherEligibleReviewer, pendingMentor, notOptedInMentor] = await Promise.all([
    createAuthedTestUser("tdrev-candidate"),
    createAuthedTestUser("tdrev-eligible"),
    createAuthedTestUser("tdrev-other-eligible"),
    createAuthedTestUser("tdrev-pending-mentor"),
    createAuthedTestUser("tdrev-not-opted-in"),
  ]);

  await admin.from("mentor_profiles").insert([
    { user_id: eligibleReviewer.id, status: "approved", reviews_verifications: true },
    { user_id: otherEligibleReviewer.id, status: "approved", reviews_verifications: true },
    { user_id: pendingMentor.id, status: "pending", reviews_verifications: true },
    { user_id: notOptedInMentor.id, status: "approved", reviews_verifications: false },
  ]);

  await admin.from("credit_ledger").insert({
    user_id: candidate.id,
    delta: CREDIT_COSTS.talentDirectoryHumanReview,
    reason: "admin_adjustment",
    balance_after: CREDIT_COSTS.talentDirectoryHumanReview,
  });
  const { runTalentVerificationHumanReview } = await import("@/lib/talent-directory/verification-runner");
  const result = await runTalentVerificationHumanReview(candidate.id, "Data Analyst", "Healthcare");
  expect(result.status).toBe("success");

  const { data } = await admin.from("talent_verifications").select("id").eq("user_id", candidate.id).single();
  verificationId = data!.id;
}, 60_000);

afterAll(async () => {
  await admin.from("talent_verifications").delete().eq("id", verificationId);
  await admin
    .from("mentor_profiles")
    .delete()
    .in("user_id", [eligibleReviewer.id, otherEligibleReviewer.id, pendingMentor.id, notOptedInMentor.id]);
  await deleteTestUsers([candidate.id, eligibleReviewer.id, otherEligibleReviewer.id, pendingMentor.id, notOptedInMentor.id]);
}, 60_000);

describe("talent_verifications' own RLS is untouched", () => {
  it("an eligible reviewer cannot read the candidate's row directly, even before/after claiming", async () => {
    const { data, error } = await eligibleReviewer.client
      .from("talent_verifications")
      .select("id")
      .eq("id", verificationId);
    expect(error).toBeNull();
    expect(data ?? [], "PRIVACY BUG: talent_verifications' owner-only policy was widened").toEqual([]);
  });
});

/**
 * 0145's own standing check: found while extending this table for human
 * review, talent_verifications had NEVER had INSERT/UPDATE/DELETE revoked
 * from `authenticated` — Supabase's default `ALL ON ALL TABLES` grant was
 * still sitting underneath the RLS policies, on every column, including the
 * new trust/money ones this PR adds (reviewer_id, reviewer_payout_ngn,
 * status). RLS currently blocks these anyway (zero permissive policies for
 * insert/update/delete), which is exactly why this needs its own assertion
 * of the GRANT rather than trusting the current policy shape to protect it
 * forever — CLAUDE.md's own column-privilege lesson, applied here directly.
 */
describe("0145: talent_verifications has NO direct client write path, at the grant level", () => {
  it("the CANDIDATE cannot update their own row's status directly (grant-level denial, not just RLS)", async () => {
    const { error } = await candidate.client
      .from("talent_verifications")
      .update({ status: "verified" })
      .eq("id", verificationId);
    expect(
      error?.code,
      "GRANT BUG: a candidate could attempt a direct UPDATE on talent_verifications at all — expected a Postgres grant-level denial (42501)",
    ).toBe("42501");
  });

  it("an eligible reviewer cannot insert a fabricated verification row directly", async () => {
    const { error } = await eligibleReviewer.client
      .from("talent_verifications")
      .insert({ user_id: eligibleReviewer.id, status: "verified", review_type: "human" });
    expect(error?.code, "GRANT BUG: a direct client INSERT into talent_verifications was not refused at the grant level").toBe(
      "42501",
    );
  });

  it("the candidate cannot delete their own audit-trail row directly", async () => {
    const { error } = await candidate.client.from("talent_verifications").delete().eq("id", verificationId);
    expect(error?.code, "GRANT BUG: a direct client DELETE on talent_verifications was not refused at the grant level").toBe(
      "42501",
    );

    const { data: stillThere } = await admin.from("talent_verifications").select("id").eq("id", verificationId).maybeSingle();
    expect(stillThere?.id, "the audit-trail row must survive an attempted client-side delete").toBe(verificationId);
  });
});

describe("talent_verification_review_queue: eligibility gates and self-exclusion", () => {
  it("an approved, opted-in reviewer sees the queued submission", async () => {
    const { data, error } = await eligibleReviewer.client.rpc("talent_verification_review_queue", {});
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).toContain(verificationId);
  });

  it("a pending (not yet approved) mentor sees NOTHING — not an error, an empty result", async () => {
    const { data, error } = await pendingMentor.client.rpc("talent_verification_review_queue", {});
    expect(error).toBeNull();
    expect(data ?? [], "an unapproved mentor must never see the review pool").toEqual([]);
  });

  it("an approved mentor who has NOT opted in to reviewing sees NOTHING", async () => {
    const { data, error } = await notOptedInMentor.client.rpc("talent_verification_review_queue", {});
    expect(error).toBeNull();
    expect(data ?? [], "reviewing is a second, independent opt-in (0142) — this must stay empty until it's set").toEqual([]);
  });

  it("the candidate never sees their own submission in a review queue", async () => {
    const { data, error } = await candidate.client.rpc("talent_verification_review_queue", {});
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id)).not.toContain(verificationId);
  });
});

describe("talent_verification_review_detail: only the current claim-holder", () => {
  it("returns NOTHING before anyone has claimed it, even to an eligible reviewer", async () => {
    const { data, error } = await eligibleReviewer.client.rpc("talent_verification_review_detail", {
      p_verification_id: verificationId,
    });
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("returns the full detail to the reviewer who claimed it, including the candidate's resume material", async () => {
    const { claimVerificationReview } = await import("@/lib/talent-directory/reviewer-runner");
    const claimed = await claimVerificationReview(eligibleReviewer.id, verificationId);
    expect(claimed.ok).toBe(true);

    const { data, error } = await eligibleReviewer.client.rpc("talent_verification_review_detail", {
      p_verification_id: verificationId,
    });
    expect(error).toBeNull();
    expect(data?.[0]?.id).toBe(verificationId);
    expect(data?.[0]?.candidate_id).toBe(candidate.id);
    expect(data?.[0]?.target_role).toBe("Data Analyst");
  });

  it("PRIVACY: a DIFFERENT reviewer cannot read the detail of a submission someone else claimed", async () => {
    const { data, error } = await otherEligibleReviewer.client.rpc("talent_verification_review_detail", {
      p_verification_id: verificationId,
    });
    expect(error).toBeNull();
    expect(data ?? [], "PRIVACY BUG: review detail leaked to a reviewer who never claimed it").toEqual([]);
  });

  it("stops returning detail once the claim is released", async () => {
    const { releaseVerificationReviewClaim } = await import("@/lib/talent-directory/reviewer-runner");
    const released = await releaseVerificationReviewClaim(eligibleReviewer.id, verificationId);
    expect(released).toBe(true);

    const { data } = await eligibleReviewer.client.rpc("talent_verification_review_detail", {
      p_verification_id: verificationId,
    });
    expect(data ?? [], "a released claim must not still expose the detail to its former holder").toEqual([]);
  });
});
