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
 * TWO REAL SOURCES OF CROSS-SUITE CONTENTION HIT THIS FILE DURING
 * DEVELOPMENT — worth naming, because both broke `main`'s CI directly, not
 * just a local run, and both are now actually FIXED rather than
 * documented-and-tolerated:
 *
 *  1. The eligible-board query's `.limit()` had no `.order()` ahead of it —
 *     non-deterministic once real row count (this repo's own test suite
 *     creates open `job_postings` fixtures in 50+ files, all sharing one
 *     database within a single CI workflow job) passed the cap, so a
 *     just-inserted test posting could be silently excluded from the
 *     returned page. Fixed by ordering newest-first before the limit, and
 *     by raising the cap itself (see MAX_ELIGIBLE_POSTINGS's own comment)
 *     — CI-wide fixture noise needed real headroom, not just determinism.
 *  2. A posting deleted mid-run (by another suite's own cleanup) failed a
 *     user's WHOLE match_scores batch on one stale foreign-key reference —
 *     see refresh-job.ts's own header for the real fix
 *     (`persistScoresOrRetryStale`), which retries with the stale
 *     reference filtered out instead of losing an otherwise-valid batch.
 *
 * Both are this repo's own documented class of shared-DB contention
 * (CLAUDE.md: "expect other concurrent sessions' fixtures... in it"), and
 * — corrected from an earlier version of this comment — NEITHER is
 * CI-exempt: CI gives each WORKFLOW JOB its own ephemeral database, but
 * every test FILE within that one job still shares that single database in
 * parallel with every other file. A future addition to this file should
 * assume CI-wide contention is real, not assume the ephemeral database
 * makes it moot.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  runMatchScoreRefreshJob,
  filterScorablePostings,
  persistScoresOrRetryStale,
  type ScorableJobPosting,
} from "@/lib/matching/refresh-job";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";
import type { TablesInsert } from "@/lib/supabase/types";
import type { ScoredJobLike } from "@/lib/matching/compute-and-store";

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

describe("persistScoresOrRetryStale — the FK-violation retry path itself, deterministically", () => {
  // Direct, deterministic coverage of the fix in refresh-job.ts's own "A
  // NARROW RACE, FOUND, THEN ACTUALLY FIXED NOT JUST DOCUMENTED" section:
  // three consecutive clean combined-suite runs were good evidence the fix
  // reduces real-world flakiness, but that's probabilistic evidence for an
  // intermittent failure, not a targeted proof of this function's own
  // branches. Each test below constructs the FK-violation condition
  // directly (a `job_posting_id` that was never inserted, standing in for
  // "deleted mid-run") rather than trying to reproduce real cross-suite
  // contention.
  let user: string;
  let posting: string;

  beforeAll(async () => {
    const seeker = await createTestUser("msrls-retry-seeker");
    user = seeker.id;
    createdUsers.push(user);
    // external, not internal — this test only needs a real job_postings row
    // to reference, not an organisation (internal postings require one via
    // the job_postings_internal_has_org check constraint).
    posting = await insertPosting({ source_type: "external", external_source: "msrls-retry-test", external_url: `https://example.test/${randomUUID()}` });
  }, 30_000);

  function scoredRow(jobPostingId: string): ScoredJobLike {
    return {
      job: { id: jobPostingId },
      score: 42,
      tier: "fair",
      explanation: { matchedSkills: ["sql"], missingSkills: [], seniorityAlignment: "unknown" },
    };
  }

  it("persists normally when every posting in the batch is real — no FK violation to recover from", async () => {
    const result = await persistScoresOrRetryStale(admin, user, [scoredRow(posting)]);
    expect(result).toEqual({ persisted: 1, ok: true });

    const row = await matchScoreFor(user, posting);
    expect(row?.score).toBe(42);
  });

  it("retries with survivors and reports the partial count when one posting in the batch no longer exists", async () => {
    const deletedPostingId = randomUUID();
    const otherSeeker = await createTestUser("msrls-retry-seeker-partial");
    createdUsers.push(otherSeeker.id);

    const result = await persistScoresOrRetryStale(admin, otherSeeker.id, [
      scoredRow(posting),
      scoredRow(deletedPostingId),
    ]);

    expect(result, "the survivor must persist even though one row in the batch pointed at a stale posting").toEqual({
      persisted: 1,
      ok: true,
    });

    const survivorRow = await matchScoreFor(otherSeeker.id, posting);
    expect(survivorRow?.score).toBe(42);
    const staleRow = await matchScoreFor(otherSeeker.id, deletedPostingId);
    expect(staleRow, "the stale posting must never end up with a row — it doesn't exist to reference").toBeNull();
  });

  it("reports failure, not a false success, when every posting in the batch is stale", async () => {
    const allStaleSeeker = await createTestUser("msrls-retry-seeker-all-stale");
    createdUsers.push(allStaleSeeker.id);

    const result = await persistScoresOrRetryStale(admin, allStaleSeeker.id, [
      scoredRow(randomUUID()),
      scoredRow(randomUUID()),
    ]);

    expect(
      result,
      "summary.failed must actually increment here — a caller trusting {ok:true} with persisted:0 would silently under-count a real failure",
    ).toEqual({ persisted: 0, ok: false });
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
