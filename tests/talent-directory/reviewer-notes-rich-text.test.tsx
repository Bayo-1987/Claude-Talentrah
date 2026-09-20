/**
 * send-372 — the round trip for a human reviewer's "Notes for the
 * candidate" (decide-form.tsx), now bold/italic markdown instead of plain
 * text. Real write (resolveVerificationReview -> resolve_talent_verification),
 * real read (getVerificationHistory, the candidate's own confirmed display
 * site at /talent-directory/verify), real render (renderInlineMarkdown),
 * same "prove the actual path, not just the pure functions separately"
 * standard as tests/resume-builder/experience-bullets-rich-text.test.tsx.
 *
 * Deliberately reuses reviewer-claim-race.test.ts's own fixture shape
 * (createTestUser, mentor_profiles, credit_ledger, queueOneSubmission via
 * runTalentVerificationHumanReview) rather than a second hand-rolled copy.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import { claimVerificationReview, resolveVerificationReview } from "@/lib/talent-directory/reviewer-runner";
import { renderInlineMarkdown } from "@/lib/farah/render-markdown";
import { CREDIT_COSTS } from "@/lib/credits/costs";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Reviewer notes rich-text test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let candidateId: string;
let reviewerId: string;

beforeAll(async () => {
  const [candidate, reviewer] = await Promise.all([
    createTestUser("reviewer-notes-candidate"),
    createTestUser("reviewer-notes-reviewer"),
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

/**
 * getVerificationHistory (queries.ts) calls createClient(), which reads
 * cookies() — a real Next.js request scope this test process doesn't have
 * ("`cookies` was called outside a request scope", confirmed directly
 * against this exact call before adding this helper). Same reasoning as
 * reviewer-claim-race.test.ts's own admin.from("talent_verifications")
 * reads: this replicates getVerificationHistory's EXACT select/order/map
 * (queries.ts:78-88) via the service-role client instead, which returns the
 * identical shape for a query already scoped to one user_id — RLS isn't
 * what's under test here, the column mapping is.
 */
async function verificationHistoryFor(userId: string) {
  const { data, error } = await admin
    .from("talent_verifications")
    .select("id, status, ai_score, ai_feedback, requested_at, decided_at")
    .eq("user_id", userId)
    .order("requested_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    status: r.status,
    score: r.ai_score,
    feedback: r.ai_feedback,
    requestedAt: r.requested_at,
    decidedAt: r.decided_at,
  }));
}

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

describe("a human reviewer's formatted note reaches the candidate's own verify page", () => {
  it("round-trips through resolveVerificationReview -> getVerificationHistory -> renderInlineMarkdown", async () => {
    const verificationId = await queueOneSubmission();
    const claim = await claimVerificationReview(reviewerId, verificationId);
    expect(claim.ok).toBe(true);

    const notes = "**Strong** resume overall, but *recent* experience is thin.";
    const decision = await resolveVerificationReview(reviewerId, verificationId, candidateId, false, notes);
    expect(decision.status).toBe("success");

    const history = await verificationHistoryFor(candidateId);
    const entry = history.find((h) => h.id === verificationId);
    expect(entry, "REGRESSION: the just-decided submission is missing from the candidate's own history read").toBeTruthy();

    // The exact markdown string, unmangled — proves the write path (both
    // p_feedback and p_reviewer_notes get `notes`, see reviewer-runner.ts's
    // own comment) and the read path (getVerificationHistory's ai_feedback
    // column, aliased `feedback`) genuinely round-trip the reviewer's text.
    expect(entry?.feedback).toBe(notes);

    // The actual render this ticket is about: the candidate's own page
    // renders this through renderInlineMarkdown, not raw — confirm real
    // <strong>/<em> output, not literal asterisks.
    const html = renderToStaticMarkup(<>{renderInlineMarkdown(entry!.feedback!)}</>);
    expect(html).toContain("<strong>Strong</strong>");
    expect(html).toContain("<em>recent</em>");
    expect(html).not.toContain("**");
    expect(html).not.toMatch(/(?<!<em>)\*(?!\/em>)/); // no stray literal asterisks left over
  });

  it("REGRESSION: a plain, unformatted note still round-trips as plain text", async () => {
    // send-372 didn't change what a reviewer CAN type, just what they can do
    // with it — plain text is still fully valid input and must not be
    // mangled by the markdown round trip (e.g. an accidental single "*"
    // being swallowed or misrendered).
    const verificationId = await queueOneSubmission();
    await claimVerificationReview(reviewerId, verificationId);

    const notes = "Solid, specific resume with real ownership shown.";
    const decision = await resolveVerificationReview(reviewerId, verificationId, candidateId, true, notes);
    expect(decision.status).toBe("success");

    const history = await verificationHistoryFor(candidateId);
    const entry = history.find((h) => h.id === verificationId);
    expect(entry?.feedback).toBe(notes);

    const html = renderToStaticMarkup(<>{renderInlineMarkdown(entry!.feedback!)}</>);
    expect(html).toContain("Solid, specific resume with real ownership shown.");
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("<em>");
  });
});
