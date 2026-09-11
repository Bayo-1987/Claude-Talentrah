import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { computeMatchScore } from "./score";
import { getMatchTier } from "@/lib/match-tier";
import { persistMatchScores, type ScoredJobLike } from "./compute-and-store";
import { freshnessFloorISO } from "@/lib/jobs/freshness";
import type { StructuredResume } from "@/lib/resume/types";
import type { SeniorityLevel } from "@/lib/jobs/types";

/**
 * send-latency-2 — the background scoring-refresh job docs/jobs-feed-
 * pagination.md's own "Step 2" scoped and deferred (2026-09-08): "the honest
 * scope for match_scores-backed ranked pagination is closer to a background
 * scoring/refresh job than a query change, and deserves its own design pass
 * rather than being folded into an egress fix."
 *
 * ── WHAT THIS DOES AND DOES NOT DO ──────────────────────────────────────
 *
 * Fills `match_scores` GAPS — (user, posting) pairs that have never been
 * scored, because the posting is newer than the user's last feed render, or
 * the user has never rendered a scored surface at all. It does NOT re-score
 * a pair that already has a row, even a stale one (a resume edit doesn't
 * retroactively invalidate old scores here) — that is a different, separate
 * problem from the coverage gap this job exists to close, and conflating
 * the two would make one run responsible for both "new posting arrived" and
 * "user changed their resume," with no way to tell from a stale row alone
 * which case it is.
 *
 * This does NOT flip the feed's own Recommended/External/Saved query over
 * to real `ORDER BY score DESC LIMIT/OFFSET` pagination — that is
 * deliberately separate, follow-on work. Coverage has to be reliably high
 * BEFORE that cutover is safe (the pagination doc's own reasoning: an
 * `INNER JOIN` drops every unscored posting, a `LEFT JOIN` sorts them to the
 * bottom indefinitely). This job is what makes coverage reliably high; the
 * query cutover is a second, later change once it demonstrably is.
 *
 * `computeMatchScore` is a pure, synchronous function with no LLM call
 * (confirmed by send-158's own investigation before building on it) — so
 * unlike every other cron job in this codebase's admin surface, this one has
 * no LLM-cost or quota concern at all. The real cost is DB round trips, not
 * money, which is what the two caps below actually bound.
 *
 * ── WHY A PLAIN PER-USER LOOP, NOT A SET-BASED SQL FUNCTION ──────────────
 *
 * The obvious more-scalable design is a single SQL query doing the
 * user × posting anti-join server-side (`NOT EXISTS` against match_scores'
 * own unique index). Deliberately not built that way: it needs a new
 * migration for no schema reason (this is application logic, not a
 * trust boundary — nothing here needs SECURITY DEFINER), and at TODAY's
 * real scale — 7 users with a base resume, a few hundred eligible postings
 * (docs/jobs-feed-pagination.md's own measured numbers) — a per-user loop
 * costs at most a few thousand simple, indexed queries per run, which is
 * nothing. This mirrors the exact shape `sendJobMatchDigest`
 * (src/lib/digest/send.ts) and `runMentorshipSweep`
 * (src/lib/mentorship/sweep.ts) already use for the same kind of
 * per-recipient cron work. If `usersConsidered` ever regularly approaches
 * MAX_USERS_PER_RUN, or `eligiblePostings` regularly approaches
 * MAX_ELIGIBLE_POSTINGS, that is the real signal this needs to become a
 * set-based query — not a schedule change or a bigger cap.
 *
 * ── A NARROW, SELF-HEALING RACE, INHERITED FROM persistMatchScores ──────
 *
 * `persistMatchScores` upserts one user's whole missing-score batch in a
 * single statement and — deliberately, per its own header ("no response
 * left to fail") — logs rather than throws on error. If a posting in that
 * batch is deleted (the daily stale-posting sweep, or an employer's own
 * delete, send-160) between this job's board read and that user's write,
 * the WHOLE batch for that user fails, not just the one stale row — this
 * job's own eligible-board read happens once at the top of the run, so the
 * window is real, if narrow. Nothing is left inconsistent: the deleted
 * posting drops out of the NEXT run's eligible board by construction (it no
 * longer exists to be "missing"), so that user's other, still-valid gaps
 * simply get filled on the next run instead of this one — a delayed
 * refresh, not a wrong one. Confirmed live during development: running this
 * job's own test suite alongside other job_postings-fixture-churning suites
 * reproduces this exact race (see refresh-job.test.ts's own header) — real
 * cross-suite test contention on a shared, mutating table, not a production
 * concern at anything like that frequency.
 *
 * CORRECTION, found the hard way: an earlier version of this comment (and
 * of refresh-job.test.ts's own header) claimed this "does not reproduce in
 * CI, where every job gets its own exclusive, ephemeral database" — true at
 * the wrong granularity. CI does give each WORKFLOW JOB (Typecheck/lint/
 * unit vs. Playwright e2e) its own ephemeral database, but every test FILE
 * within that one job still runs against that SAME single database, in
 * parallel with every other file — the eligible-board query below hit
 * exactly this in a real CI run: `.limit(MAX_ELIGIBLE_POSTINGS)` with no
 * `.order()` let another test file's concurrently-open job_postings
 * fixtures silently push a just-inserted posting out of the returned page.
 * Fixed by ordering newest-first before the limit (see below) rather than
 * by narrowing the claim further — the underlying non-determinism was a
 * real bug regardless of which environment surfaced it first.
 */

export interface MatchScoreRefreshSummary {
  /** False only if a query this job cannot work around (the eligible-board fetch, or the candidate-user fetch) itself failed. */
  ok: boolean;
  eligiblePostings: number;
  usersConsidered: number;
  /** A candidate user whose match_scores already cover every eligible posting — the common case once this job has run a few times. */
  usersUpToDate: number;
  usersRefreshed: number;
  postingsScored: number;
  failed: number;
  errors: Array<{ userId: string; message: string }>;
}

/**
 * Bounded so one run cannot fan out unboundedly as the user base grows —
 * same reasoning and the same order of magnitude as
 * `sendJobMatchDigest`'s own MAX_RECIPIENTS_PER_RUN (500, src/lib/digest/
 * send.ts). Real headroom today: 7 users have a base resume.
 */
const MAX_USERS_PER_RUN = 500;

/**
 * Same number and the same reasoning as jobs/page.tsx's own
 * RECOMMENDED_HARD_CAP — kept as a separate local constant rather than a
 * shared import, matching this codebase's established "three copies, not
 * shared" convention for feed-eligibility queries
 * (docs/jobs-feed-pagination.md), for the same reason: Supabase's
 * `.select()` reads the literal type of its argument, so a column list
 * passed as a runtime parameter to one shared function loses type safety
 * here without reaching for generic query-builder types this codebase
 * doesn't otherwise use.
 */
const MAX_ELIGIBLE_POSTINGS = 2000;

export interface ScorableJobPosting {
  id: string;
  structuredJd: unknown;
  seniority: SeniorityLevel | null;
  organizationId: string | null;
}

/**
 * The org-verification gate, done by hand — same reason and same shape as
 * `filterListablePostings` (src/lib/digest/send.ts): this job reads through
 * the SERVICE ROLE client, which bypasses RLS entirely, so nothing here
 * automatically gets `organizations.verified` enforced the way the feed's
 * own session-scoped query does for free (0027/0109's own finding: a
 * DEFINER function — and by the same logic, a service-role read — silently
 * opts out of a policy unless it re-implements the check). An unlisted
 * posting is excluded earlier, at the SQL level (matching
 * `boardAggregateQuery`'s own `.or()` clause with no viewer-org exception —
 * this job has no single "viewer" to grant one to, the same reasoning
 * `filterListablePostings`'s own header gives for a digest email).
 *
 * Pure and exported so this is testable without a database, matching this
 * repo's own convention (`selectDigestJobs`, `filterListablePostings`,
 * `getJobShareVisibility`).
 */
export function filterScorablePostings(
  postings: ScorableJobPosting[],
  verifiedOrganizationIds: ReadonlySet<string>,
): ScorableJobPosting[] {
  return postings.filter((p) => p.organizationId === null || verifiedOrganizationIds.has(p.organizationId));
}

export async function runMatchScoreRefreshJob(): Promise<MatchScoreRefreshSummary> {
  const summary: MatchScoreRefreshSummary = {
    ok: true,
    eligiblePostings: 0,
    usersConsidered: 0,
    usersUpToDate: 0,
    usersRefreshed: 0,
    postingsScored: 0,
    failed: 0,
    errors: [],
  };

  const admin = createServiceRoleClient();

  // The whole eligible board, fetched ONCE per run — it's the same set for
  // every user this run considers, unlike match_scores coverage which is
  // per-user. Lightweight columns only (id/structured_jd/seniority/
  // organization_id), the same reasoning BOARD_AGGREGATE_COLUMNS already
  // documents in jobs/page.tsx: this never renders anything, so it has no
  // reason to carry a description or a salary range.
  // `.order()` before `.limit()` is load-bearing, not cosmetic: with no
  // explicit order, which rows a `.limit()` past the true row count returns
  // is whatever the query planner happens to scan first — observed live in
  // CI (a real, reproducible failure, not a one-off): a posting inserted
  // moments earlier in the SAME ephemeral database (many other test files'
  // own job_postings fixtures share it, this job's own "prove it" pass
  // originally assumed otherwise) was silently excluded once total open,
  // fresh-enough postings passed the cap. Ordering newest-first both fixes
  // that determinism gap AND is the more correct behaviour in production —
  // a hard cap should drop the STALEST rows within the freshness window
  // first, not an arbitrary scan-order slice of them.
  const { data: rawPostings, error: postingsError } = await admin
    .from("job_postings")
    .select("id, structured_jd, seniority, organization_id")
    .eq("status", "open")
    .gte("posted_at", freshnessFloorISO())
    .or("unlisted_at.is.null,admin_review_decision.eq.approved")
    .order("posted_at", { ascending: false })
    .limit(MAX_ELIGIBLE_POSTINGS);

  if (postingsError) {
    console.error(`[match-score-refresh] eligible-board query failed: ${postingsError.message}`);
    summary.ok = false;
    return summary;
  }

  const candidatePostings: ScorableJobPosting[] = (rawPostings ?? []).map((p) => ({
    id: p.id,
    structuredJd: p.structured_jd,
    seniority: p.seniority,
    organizationId: p.organization_id,
  }));

  const organizationIds = Array.from(
    new Set(candidatePostings.map((p) => p.organizationId).filter((id): id is string => id !== null)),
  );

  let verifiedOrganizationIds = new Set<string>();
  if (organizationIds.length > 0) {
    const { data: orgs, error: orgError } = await admin
      .from("organizations")
      .select("id")
      .in("id", organizationIds)
      .eq("verified", true);
    if (orgError) {
      console.error(`[match-score-refresh] org-verification query failed: ${orgError.message}`);
      summary.ok = false;
      return summary;
    }
    verifiedOrganizationIds = new Set((orgs ?? []).map((o) => o.id));
  }

  const eligible = filterScorablePostings(candidatePostings, verifiedOrganizationIds);
  summary.eligiblePostings = eligible.length;
  if (eligible.length === 0) return summary;

  const { data: candidates, error: candidatesError } = await admin
    .from("resumes")
    .select("user_id")
    .eq("is_base", true)
    .limit(MAX_USERS_PER_RUN);

  if (candidatesError) {
    console.error(`[match-score-refresh] candidate-user query failed: ${candidatesError.message}`);
    summary.ok = false;
    return summary;
  }

  summary.usersConsidered = candidates?.length ?? 0;

  for (const { user_id: userId } of candidates ?? []) {
    try {
      // Cheap existence check BEFORE fetching this user's (potentially
      // large) resume content — the common case, once this job has run a
      // few times, is full coverage and nothing further to read.
      const { data: existing, error: existingError } = await admin
        .from("match_scores")
        .select("job_posting_id")
        .eq("user_id", userId);
      if (existingError) throw new Error(existingError.message);

      const scoredIds = new Set((existing ?? []).map((r) => r.job_posting_id));
      const missing = eligible.filter((p) => !scoredIds.has(p.id));

      if (missing.length === 0) {
        summary.usersUpToDate++;
        continue;
      }

      const { data: resumeRow, error: resumeError } = await admin
        .from("resumes")
        .select("structured_content")
        .eq("user_id", userId)
        .eq("is_base", true)
        .maybeSingle();
      if (resumeError) throw new Error(resumeError.message);
      // The base resume was deleted/unset between the candidate-user query
      // above and here — nothing to score against, not a failure.
      if (!resumeRow) {
        summary.usersUpToDate++;
        continue;
      }

      const resume = resumeRow.structured_content as unknown as StructuredResume;

      // Same three-line body as scoreJobs (compute-and-store.ts), not a
      // call to it: scoreJobs takes a full JobPosting row shape (the feed's
      // own FEED_COLUMNS width), and this job only ever has the lightweight
      // id/structured_jd/seniority columns above — the same reason
      // computeAndStoreApplicationMatchScore (send-158) doesn't call
      // scoreJobs either. computeMatchScore itself, the shared pure
      // primitive, is untouched either way.
      const scored: ScoredJobLike[] = missing.map((job) => {
        const structuredJd = job.structuredJd as { skills?: string[] } | null;
        const result = computeMatchScore(resume, structuredJd?.skills ?? [], job.seniority ?? undefined);
        return {
          job: { id: job.id },
          score: result.score,
          tier: getMatchTier(result.score),
          explanation: result.explanation,
        };
      });

      await persistMatchScores(userId, scored);
      summary.usersRefreshed++;
      summary.postingsScored += scored.length;
    } catch (err) {
      summary.failed++;
      summary.errors.push({ userId, message: err instanceof Error ? err.message : String(err) });
      console.error(`[match-score-refresh] failed for user ${userId}:`, err);
    }
  }

  console.log(
    `[match-score-refresh] eligiblePostings=${summary.eligiblePostings} usersConsidered=${summary.usersConsidered} ` +
      `usersUpToDate=${summary.usersUpToDate} usersRefreshed=${summary.usersRefreshed} ` +
      `postingsScored=${summary.postingsScored} failed=${summary.failed}`,
  );
  return summary;
}
