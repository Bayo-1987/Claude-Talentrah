import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { computeMatchScore } from "./score";
import { getMatchTier } from "@/lib/match-tier";
import type { ScoredJobLike } from "./compute-and-store";
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
 * ── A NARROW RACE, FOUND, THEN ACTUALLY FIXED NOT JUST DOCUMENTED ────────
 *
 * If a posting is deleted (the daily stale-posting sweep, or an employer's
 * own delete, send-160) between this job's board read and a user's write,
 * a naive batch upsert fails the WHOLE batch on one stale row. An earlier
 * version of this job called the shared `persistMatchScores`
 * (compute-and-store.ts), which deliberately logs rather than throws on
 * error (correct for ITS other callers, which have no response left to act
 * on a failure) — and reasoned that losing a whole batch here was
 * "self-healing," since the deleted posting drops out of the NEXT run's
 * eligible board by construction. That reasoning was too optimistic in
 * practice: running this job's own test suite alongside other
 * job_postings-fixture-churning suites hit this race often enough, in both
 * local runs and CI, to make the test suite itself unreliable — "self-heals
 * eventually" is a poor substitute for "actually works this run" when the
 * failure rate is that high.
 *
 * Fixed for real: `persistScoresOrRetryStale` (below) does the upsert
 * directly rather than through `persistMatchScores`, so it can SEE a
 * foreign-key violation, re-check which of the batch's postings still
 * exist, and retry with only the survivors — the common case (one stale
 * reference among many valid ones) now succeeds instead of losing
 * everything, and `summary.failed` only ever reports a genuine,
 * unrecovered failure rather than silently under-counting one.
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
 * Deliberately much larger than jobs/page.tsx's own RECOMMENDED_HARD_CAP
 * (2000), even though both exist for the same reason (production headroom
 * — the real board is 338-673 rows today, so either number is "pure
 * headroom, not a current-behavior change" against production alone). This
 * one has a second constraint the feed's cap does not: this repo's own
 * test suite creates open job_postings fixtures in 50+ files, all sharing
 * one database within a single CI workflow job (see the correction above,
 * and refresh-job.test.ts's own header) — at 2000, a real CI run's
 * peak concurrent fixture count was enough to push a just-inserted test
 * posting out of this query's page even with newest-first ordering, and
 * broke `main` directly. 20000 is still a real, meaningful cap (protects
 * against genuine unbounded growth at a scale far beyond anything this
 * product has hit), just large enough that CI's own test-fixture noise
 * can't realistically compete with it — not a number picked to make one
 * test pass, but the same "not a current-behavior change" reasoning
 * applied to BOTH real constraints on this query, not just production's.
 */
const MAX_ELIGIBLE_POSTINGS = 20_000;

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

/**
 * The upsert, done directly here rather than via the shared
 * `persistMatchScores` (compute-and-store.ts) — that function deliberately
 * "logs rather than throws" (its own header: "no response left to fail"),
 * a correct contract for its OTHER callers (an `after()` cache write on the
 * feed, apply-time scoring) that genuinely have nothing left to do with a
 * failure. This job is different: it NEEDS to know whether a write actually
 * landed, because its own summary counts (usersRefreshed/postingsScored/
 * failed) are the only signal an operator has that the job is working —
 * silently swallowing a failed batch here means those counts lie.
 *
 * Confirmed live, repeatedly, that swallowing was actively hiding a real
 * failure: a posting deleted mid-run (see this file's own header, "A
 * NARROW, SELF-HEALING RACE") fails the WHOLE batch with a
 * `match_scores_job_posting_id_fkey` violation, and a caller that doesn't
 * see that error has no way to retry around it — usersRefreshed still
 * incremented, postingsScored still counted rows that were never written.
 * So: on a foreign-key violation specifically, re-check which of this
 * batch's postings still exist and retry with only those — the common case
 * (one stale reference among many valid ones) then succeeds instead of
 * losing everything, and the summary's `failed` count only ever reports a
 * REAL, unrecovered failure.
 */
export async function persistScoresOrRetryStale(
  admin: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  scored: ScoredJobLike[],
): Promise<{ persisted: number; ok: boolean }> {
  const rows = scored.map((s) => ({
    user_id: userId,
    job_posting_id: s.job.id,
    score: s.score,
    tier: s.tier,
    explanation: JSON.parse(JSON.stringify(s.explanation)),
    computed_at: new Date().toISOString(),
  }));

  const { error } = await admin
    .from("match_scores")
    .upsert(rows, { onConflict: "user_id,job_posting_id" });
  if (!error) return { persisted: rows.length, ok: true };

  if (error.code === "23503") {
    const ids = rows.map((r) => r.job_posting_id);
    const { data: stillExist, error: existError } = await admin
      .from("job_postings")
      .select("id")
      .in("id", ids);
    if (existError) {
      console.error(`[match-score-refresh] could not verify stale postings for ${userId}: ${existError.message}`);
      return { persisted: 0, ok: false };
    }
    const existingIds = new Set((stillExist ?? []).map((r) => r.id));
    const survivors = rows.filter((r) => existingIds.has(r.job_posting_id));
    if (survivors.length === 0) return { persisted: 0, ok: false };

    const { error: retryError } = await admin
      .from("match_scores")
      .upsert(survivors, { onConflict: "user_id,job_posting_id" });
    if (retryError) {
      console.error(
        `[match-score-refresh] retry after filtering stale postings still failed for ${userId}: ${retryError.message}`,
      );
      return { persisted: 0, ok: false };
    }
    return { persisted: survivors.length, ok: true };
  }

  console.error(`[match-score-refresh] could not persist ${rows.length} score(s) for ${userId}: ${error.message}`);
  return { persisted: 0, ok: false };
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

      const result = await persistScoresOrRetryStale(admin, userId, scored);
      if (!result.ok) {
        summary.failed++;
        summary.errors.push({ userId, message: "could not persist scores (see server log)" });
        continue;
      }
      summary.usersRefreshed++;
      summary.postingsScored += result.persisted;
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
