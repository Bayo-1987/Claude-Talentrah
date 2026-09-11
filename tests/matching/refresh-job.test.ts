/**
 * runMatchScoreRefreshJob (src/lib/matching/refresh-job.ts) — send-latency-2,
 * the background scoring-refresh job docs/jobs-feed-pagination.md's own
 * "Step 2" scoped and deferred. Runs for real against the live database,
 * same shape as tests/mentorship/session-reminders.test.ts and
 * no-show-sweep.test.ts — nothing here has an external side effect (no
 * email, no payment) to mock, so unlike those two there is nothing to mock
 * at all.
 *
 * BECAUSE THIS RUNS AGAINST THE SHARED HOSTED PROJECT, it processes every
 * real candidate user with a base resume, not just this file's fixtures —
 * that is the job's own real behaviour, not a test artefact. Every
 * assertion below is scoped to THIS FILE's own fixture ids (a specific
 * user × posting pair in match_scores), never to `summary`'s aggregate
 * counts (eligiblePostings/usersConsidered/etc.) — those legitimately
 * include ambient data from other sessions and would make this suite as
 * flaky as tests/seo/landing-page-links.test.ts's own ambient-count
 * assertions, which is exactly the failure class to avoid.
 *
 * ONE REAL SOURCE OF CROSS-SUITE FLAKINESS REMAINS, and it is worth naming
 * rather than being surprised by it later: this file can intermittently
 * fail when run alongside other suites that create and delete their own
 * `job_postings` fixtures concurrently — either a
 * `match_scores_job_posting_id_fkey` violation (see refresh-job.ts's own
 * header, "A NARROW, SELF-HEALING RACE"), or, before it was fixed, a
 * just-inserted posting silently missing from the eligible board because
 * the query's `.limit()` had no `.order()` ahead of it (also fixed there).
 * This is this repo's own documented class of shared-DB contention
 * (CLAUDE.md: "expect other concurrent sessions' fixtures... in it") —
 * **and, corrected from an earlier version of this comment, it is NOT
 * CI-exempt**: CI gives each WORKFLOW JOB its own ephemeral database, but
 * every test FILE within that one job still shares that single database in
 * parallel with every other file, so this class of contention reproduces
 * in CI too (confirmed live — this exact test failed on `main` once from
 * the ordering bug above). The ordering fix closes the specific failure
 * that hit; a future addition to this file should assume CI-wide
 * contention is real, not assume the ephemeral database makes it moot.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runMatchScoreRefreshJob, filterScorablePostings, type ScorableJobPosting } from "@/lib/matching/refresh-job";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";
import type { TablesInsert } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Match-score refresh job test cannot run: ${key} is not set.`);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

const createdUsers: string[] = [];
const createdOrgs: string[] = [];
const createdPostings: string[] = [];
const createdResumeIds: string[] = [];

afterAll(async () => {
  if (createdPostings.length) {
    const { error } = await admin.from("job_postings").delete().in("id", createdPostings);
    if (error) console.warn(`[cleanup] could not delete fixture postings: ${error.message}`);
  }
  if (createdResumeIds.length) {
    const { error } = await admin.from("resumes").delete().in("id", createdResumeIds);
    if (error) console.warn(`[cleanup] could not delete fixture resumes: ${error.message}`);
  }
  await deleteTestOrgs(createdOrgs);
  await deleteTestUsers(createdUsers);
}, 60_000);

async function insertOrg(verified: boolean) {
  const owner = await createTestUser(`msrls-org-owner-${verified ? "v" : "u"}`);
  createdUsers.push(owner.id);
  const { data, error } = await admin
    .from("organizations")
    .insert({
      name: `MSRLS ${verified ? "Verified" : "Unverified"} Org ${randomUUID().slice(0, 8)}`,
      created_by: owner.id,
      verified,
    })
    .select("id")
    .single();
  if (error) throw error;
  createdOrgs.push(data!.id as string);
  return data!.id as string;
}

async function insertPosting(
  overrides: Partial<TablesInsert<"job_postings">> & Pick<TablesInsert<"job_postings">, "source_type">,
) {
  const { data, error } = await admin
    .from("job_postings")
    .insert({
      title: "MSRLS Fixture Role",
      company_name: "MSRLS Fixture Co",
      description: "Fixture posting for the match-score refresh job suite.",
      structured_jd: { skills: ["sql", "python"] },
      status: "open",
      posted_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
      dedup_fingerprint: randomUUID(),
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  createdPostings.push(data!.id as string);
  return data!.id as string;
}

async function insertBaseResume(userId: string, skills: string[] = ["sql", "python"]) {
  const { data, error } = await admin
    .from("resumes")
    .insert({
      user_id: userId,
      is_base: true,
      structured_content: {
        contact: { name: "MSRLS Fixture Seeker" },
        summary: "Fixture resume for the match-score refresh job suite.",
        experience: [],
        education: [],
        skills,
      },
    })
    .select("id")
    .single();
  if (error) throw error;
  createdResumeIds.push(data!.id as string);
}

async function matchScoreFor(userId: string, jobPostingId: string) {
  const { data } = await admin
    .from("match_scores")
    .select("score, computed_at")
    .eq("user_id", userId)
    .eq("job_posting_id", jobPostingId)
    .maybeSingle();
  return data;
}

describe("filterScorablePostings — the pure org-verification gate, no database involved", () => {
  const posting = (overrides: Partial<ScorableJobPosting>): ScorableJobPosting => ({
    id: "posting-x",
    structuredJd: { skills: [] },
    seniority: null,
    organizationId: null,
    ...overrides,
  });

  it("keeps a verified organisation's posting", () => {
    const result = filterScorablePostings([posting({ organizationId: "org-1" })], new Set(["org-1"]));
    expect(result).toHaveLength(1);
  });

  it("drops an unverified organisation's posting", () => {
    const result = filterScorablePostings([posting({ organizationId: "org-2" })], new Set(["org-1"]));
    expect(result).toHaveLength(0);
  });

  it("keeps an external posting (no organisation to verify)", () => {
    const result = filterScorablePostings([posting({ organizationId: null })], new Set());
    expect(result).toHaveLength(1);
  });
});

describe("runMatchScoreRefreshJob — real gap-filling against the live database", () => {
  let seekerId: string;
  let verifiedOrgId: string;
  let unverifiedOrgId: string;

  let postingVerified: string;
  let postingUnverified: string;
  let postingUnlisted: string;
  let postingUnlistedApproved: string;
  let postingExternal: string;
  let postingStale: string;
  let postingClosed: string;

  beforeAll(async () => {
    const seeker = await createTestUser("msrls-seeker");
    seekerId = seeker.id;
    createdUsers.push(seekerId);
    await insertBaseResume(seekerId);

    [verifiedOrgId, unverifiedOrgId] = await Promise.all([insertOrg(true), insertOrg(false)]);

    [postingVerified, postingUnverified, postingUnlisted, postingUnlistedApproved, postingExternal, postingStale, postingClosed] =
      await Promise.all([
        insertPosting({ source_type: "internal", organization_id: verifiedOrgId }),
        insertPosting({ source_type: "internal", organization_id: unverifiedOrgId }),
        insertPosting({ source_type: "internal", organization_id: verifiedOrgId, unlisted_at: new Date().toISOString() }),
        insertPosting({
          source_type: "internal",
          organization_id: verifiedOrgId,
          unlisted_at: new Date().toISOString(),
          admin_review_decision: "approved",
        }),
        insertPosting({ source_type: "external", external_source: "msrls-test", external_url: `https://example.test/${randomUUID()}` }),
        insertPosting({ source_type: "internal", organization_id: verifiedOrgId, posted_at: daysAgo(45) }),
        insertPosting({ source_type: "internal", organization_id: verifiedOrgId, status: "closed" }),
      ]);
  }, 60_000);

  it("fills exactly the gaps a real seeker should have, and no others", async () => {
    const summary = await runMatchScoreRefreshJob();
    expect(summary.ok).toBe(true);

    const [verified, unverified, unlisted, unlistedApproved, external, stale, closed] = await Promise.all([
      matchScoreFor(seekerId, postingVerified),
      matchScoreFor(seekerId, postingUnverified),
      matchScoreFor(seekerId, postingUnlisted),
      matchScoreFor(seekerId, postingUnlistedApproved),
      matchScoreFor(seekerId, postingExternal),
      matchScoreFor(seekerId, postingStale),
      matchScoreFor(seekerId, postingClosed),
    ]);

    expect(verified, "an open, verified-org, listed posting must be scored").not.toBeNull();
    expect(
      unverified,
      "MONEY/PRIVACY BUG: an unverified organisation's posting was scored — the service-role read bypasses RLS and must re-check verification by hand",
    ).toBeNull();
    expect(unlisted, "an unlisted posting with no admin approval must not be scored").toBeNull();
    expect(
      unlistedApproved,
      "an unlisted posting the admin queue approved for the public feed must still be scored, same as it's still shown there",
    ).not.toBeNull();
    expect(external, "an external posting must be scored — nothing to verify").not.toBeNull();
    expect(stale, "a posting older than the 30-day freshness floor must not be scored").toBeNull();
    expect(closed, "a closed posting must not be scored").toBeNull();
  }, 60_000);

  it("is a no-op the second time for a user already fully covered — no rewrite, no new rows", async () => {
    const before = await matchScoreFor(seekerId, postingVerified);
    expect(before).not.toBeNull();

    const summary = await runMatchScoreRefreshJob();
    expect(summary.ok).toBe(true);

    const after = await matchScoreFor(seekerId, postingVerified);
    // Untouched, not just "still present": if the job re-scored a pair it
    // already had, computed_at would move forward on every run forever,
    // which is exactly the "re-score everything, every time" behaviour this
    // job's own header says it deliberately does NOT do.
    expect(after?.computed_at).toBe(before?.computed_at);
    expect(after?.score).toBe(before?.score);

    // Still nothing for the postings that should never be scored for this
    // seeker, on a second run either.
    const [unverified, unlisted, stale, closed] = await Promise.all([
      matchScoreFor(seekerId, postingUnverified),
      matchScoreFor(seekerId, postingUnlisted),
      matchScoreFor(seekerId, postingStale),
      matchScoreFor(seekerId, postingClosed),
    ]);
    expect(unverified).toBeNull();
    expect(unlisted).toBeNull();
    expect(stale).toBeNull();
    expect(closed).toBeNull();
  }, 60_000);

  it("fills ONLY the gap for a user with partial existing coverage — an existing row survives untouched", async () => {
    const partialSeeker = await createTestUser("msrls-partial-seeker");
    createdUsers.push(partialSeeker.id);
    await insertBaseResume(partialSeeker.id);

    // Pre-existing, deliberately IMPLAUSIBLE score for this seeker's real
    // resume/posting pair (a real recompute would score a skills-matching
    // fixture far higher) — the `computed_at` equality check below is the
    // real proof either way, this just makes a diff obvious at a glance.
    const { error: seedError } = await admin.from("match_scores").insert({
      user_id: partialSeeker.id,
      job_posting_id: postingVerified,
      score: 1,
      tier: "fair",
      explanation: { matchedSkills: [], missingSkills: [], seniorityAlignment: "unknown" },
      computed_at: new Date(Date.now() - 3600_000).toISOString(),
    });
    if (seedError) throw seedError;

    // Read back Postgres's OWN canonical string (it round-trips as
    // `+00:00`, not the `Z` suffix `toISOString()` produces) rather than
    // comparing against the JS string that was sent — otherwise this
    // assertion would fail on a harmless formatting difference and prove
    // nothing about whether the row was actually touched.
    const preExisting = await matchScoreFor(partialSeeker.id, postingVerified);

    const summary = await runMatchScoreRefreshJob();
    expect(summary.ok).toBe(true);

    const untouched = await matchScoreFor(partialSeeker.id, postingVerified);
    expect(untouched?.score, "an EXISTING match_scores row must never be overwritten by the gap-filler").toBe(1);
    expect(untouched?.computed_at).toBe(preExisting?.computed_at);

    // The external posting had no row at all for this user — that gap must
    // still be filled even though this user already had ONE score on file.
    const filled = await matchScoreFor(partialSeeker.id, postingExternal);
    expect(filled, "a genuinely missing pair must still be filled even for a partially-covered user").not.toBeNull();
  }, 60_000);
});
