import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  AUTO_APPLY_DAILY_SUBMIT_CAP,
  AUTO_APPLY_FREE_PER_WEEK,
  AUTO_APPLY_MAX_PENDING,
  AUTO_APPLY_MIN_SCORE,
} from "./config";
import { checkPassCoverage } from "@/lib/passes/entitlement";
import { freshnessFloorISO } from "@/lib/jobs/freshness";

/**
 * Server-side Auto-Apply mechanics: what gets queued, what the caps say, and
 * what a confirmation costs.
 *
 * Everything here runs through the service role and derives its inputs from the
 * database, never from a caller. The user id is always passed down from a
 * verified session by the Server Action layer; nothing in this module accepts a
 * score, a tier, a cap or a price from outside.
 */

/** Rolling windows, in ms — see config.ts for why they're rolling, not calendar. */
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export interface QuotaState {
  submittedLast24h: number;
  submittedLast7d: number;
  dailyRemaining: number;
  freeRemaining: number;
  /** True when the next confirmed internal submission will cost credits. */
  nextSubmissionCostsCredits: boolean;
  /**
   * True when the next submission would otherwise cost credits (the free
   * weekly allowance is used up) but an active Pass, under today's fair-use
   * cap, covers it instead. Checked here rather than left for the caller to
   * infer from `nextSubmissionCostsCredits` alone, so a Pass holder past
   * their free allowance is never shown a credit price for a submission that
   * will actually be free — the same coverage confirmAutoApplyAction itself
   * checks before charging (src/lib/auto-apply/actions.ts), read here only
   * for display.
   */
  nextSubmissionCovered: boolean;
}

/**
 * Counts real, decided submissions — not queue size, and not anything the
 * client told us. `status = 'submitted'` only ever gets written after an
 * `applications` row was actually created, so this counts applications sent on
 * the user's behalf, which is what the cap is about.
 *
 * External hand-offs are excluded by construction: they land as `handed_off`.
 */
export async function getQuotaState(userId: string): Promise<QuotaState> {
  const admin = createServiceRoleClient();
  const since7d = new Date(Date.now() - WEEK_MS).toISOString();

  const { data, error } = await admin
    .from("auto_apply_queue")
    .select("decided_at")
    .eq("user_id", userId)
    .eq("status", "submitted")
    .gte("decided_at", since7d);

  // A failed count must not read as "zero used". Failing closed here means a
  // transient database error blocks a submission rather than silently
  // uncapping it — the safe direction for a cap.
  if (error) throw new Error(`Couldn't check your Auto-Apply usage: ${error.message}`);

  const now = Date.now();
  const decided = (data ?? []).map((r) => new Date(r.decided_at!).getTime());
  const submittedLast24h = decided.filter((t) => now - t < DAY_MS).length;
  const submittedLast7d = decided.length;

  const dailyRemaining = Math.max(0, AUTO_APPLY_DAILY_SUBMIT_CAP - submittedLast24h);
  const freeRemaining = Math.max(0, AUTO_APPLY_FREE_PER_WEEK - submittedLast7d);
  const nextSubmissionCostsCredits = freeRemaining === 0;

  // Only checked when it would actually change what's shown — no reason to
  // spend the query while the free allowance still covers the next one.
  const nextSubmissionCovered =
    nextSubmissionCostsCredits && (await checkPassCoverage(userId)).covered;

  return {
    submittedLast24h,
    submittedLast7d,
    dailyRemaining,
    freeRemaining,
    nextSubmissionCostsCredits,
    nextSubmissionCovered,
  };
}

export interface ScanResult {
  queued: number;
  skippedBelowThreshold: number;
  reason?: string;
}

/** An open, fresh, not-yet-excluded job before the queuing gate below has run. */
export interface QueueableJobCandidate {
  id: string;
  sourceType: string;
  /** Null for an external posting — those have no organisation to verify. */
  organizationId: string | null;
}

/**
 * The queuing gate: mirrors `filterListablePostings` in
 * `src/lib/digest/send.ts` (PR #285), which itself matches 0109's reasoning
 * for `promoted_jobs`.
 *
 * `scanAndQueue` reads through the service-role client, which bypasses RLS
 * entirely. Every RLS-gated listing surface (the feed, `search_job_postings`,
 * the sitemap, the SEO landing pages) gets `organizations.verified` enforced
 * for free by the `job postings are publicly readable` policy (0027, 0107) —
 * this read does not, because nothing here ever evaluates that policy.
 *
 * `match_scores` rows do not expire when verification does:
 * `saveCompanyProfileAction` re-runs verification in BOTH directions on a
 * domain change, so a posting scored Excellent while its org was verified can
 * keep that score long after the org un-verifies. Trusting an existing
 * `match_scores` row as proof the posting is still safe to queue is exactly
 * the assumption that produced this bug (and 0109's, and PR #285's).
 *
 * Pure and exported so this is testable without a database, matching this
 * repo's own convention (`filterListablePostings`, `selectDigestJobs`).
 */
export function filterQueueableJobs(
  jobs: QueueableJobCandidate[],
  verifiedOrganizationIds: ReadonlySet<string>,
): QueueableJobCandidate[] {
  return jobs.filter((j) => j.organizationId === null || verifiedOrganizationIds.has(j.organizationId));
}

/**
 * Finds jobs worth queuing and queues them.
 *
 * The threshold is applied against `match_scores` in the DATABASE, not against
 * anything computed client-side. This is the load-bearing line of the whole
 * feature: `.gte("score", AUTO_APPLY_MIN_SCORE)` on a table the client cannot
 * write (0031) is what makes "conservative threshold" a fact rather than a
 * setting.
 *
 * Idempotent: the unique (user_id, job_posting_id) constraint means a re-scan
 * cannot re-queue something already queued, submitted, or dismissed.
 *
 * NOTE ON WHAT THIS DOES NOT COVER: this filter runs only at queuing time. A
 * job already sitting in `auto_apply_queue` as `pending` is never re-checked
 * by this function if its org un-verifies after being queued — see the
 * confirm-time gap noted where this is called from / in the PR description.
 */
export async function scanAndQueue(userId: string): Promise<ScanResult> {
  const admin = createServiceRoleClient();

  const { data: settings } = await admin
    .from("auto_apply_settings")
    .select("enabled")
    .eq("user_id", userId)
    .maybeSingle();
  if (!settings?.enabled) return { queued: 0, skippedBelowThreshold: 0, reason: "disabled" };

  const { count: pendingCount } = await admin
    .from("auto_apply_queue")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "pending");

  const room = AUTO_APPLY_MAX_PENDING - (pendingCount ?? 0);
  if (room <= 0) return { queued: 0, skippedBelowThreshold: 0, reason: "queue_full" };

  // Above-threshold scores for this user, best first.
  const { data: scores, error: scoreErr } = await admin
    .from("match_scores")
    .select("job_posting_id, score, tier")
    .eq("user_id", userId)
    .gte("score", AUTO_APPLY_MIN_SCORE)
    .order("score", { ascending: false })
    .limit(200);
  if (scoreErr) throw new Error(`Couldn't read match scores: ${scoreErr.message}`);
  if (!scores?.length) return { queued: 0, skippedBelowThreshold: 0, reason: "no_matches" };

  const jobIds = scores.map((s) => s.job_posting_id);

  // Exclude anything already applied to or already decided on. Auto-Apply must
  // never surface a job the user has already dealt with by hand.
  const [{ data: existingApps }, { data: alreadyQueued }, { data: openJobs }] = await Promise.all([
    admin.from("applications").select("job_posting_id").eq("user_id", userId).in("job_posting_id", jobIds),
    admin.from("auto_apply_queue").select("job_posting_id").eq("user_id", userId).in("job_posting_id", jobIds),
    // Same 30-day floor as every discovery surface (src/lib/jobs/freshness.ts)
    // — an existing match_scores row for a job that has since aged out of
    // the visible feed must not make Auto-Apply queue it anyway. This is an
    // independent job_postings read (not the feed's own filtered query), so
    // it needs the floor applied here too.
    admin
      .from("job_postings")
      .select("id, source_type, status, organization_id")
      .in("id", jobIds)
      .eq("status", "open")
      // 0107, same reasoning as the freshness floor below: this is an
      // independent read, so the feed's exclusion does not reach it. An
      // unlisted posting is reachable by direct link only — auto-applying to
      // one would put a seeker in front of a job nobody listed for them.
      .is("unlisted_at", null)
      .gte("posted_at", freshnessFloorISO()),
  ]);

  const excluded = new Set([
    ...(existingApps ?? []).map((a) => a.job_posting_id),
    ...(alreadyQueued ?? []).map((q) => q.job_posting_id),
  ]);

  // Which of the internal candidates' organisations are CURRENTLY verified —
  // see filterQueueableJobs's own header for why an existing match_scores
  // row cannot be trusted to mean this on its own.
  const candidateOrgIds = Array.from(
    new Set((openJobs ?? []).map((j) => j.organization_id).filter((id): id is string => id !== null)),
  );
  let verifiedOrganizationIds = new Set<string>();
  if (candidateOrgIds.length > 0) {
    const { data: orgs, error: orgErr } = await admin
      .from("organizations")
      .select("id")
      .in("id", candidateOrgIds)
      .eq("verified", true);
    if (orgErr) throw new Error(`Couldn't check organisation verification: ${orgErr.message}`);
    verifiedOrganizationIds = new Set((orgs ?? []).map((o) => o.id));
  }

  // filterQueueableJobs decides WHICH ids clear the gate; the map below is
  // still built from the original, fully-typed rows so source_type keeps its
  // real "internal" | "external" literal type rather than widening to string.
  const queueableIds = new Set(
    filterQueueableJobs(
      (openJobs ?? []).map((j) => ({ id: j.id, sourceType: j.source_type, organizationId: j.organization_id })),
      verifiedOrganizationIds,
    ).map((j) => j.id),
  );
  const openById = new Map(
    (openJobs ?? []).filter((j) => queueableIds.has(j.id)).map((j) => [j.id, j]),
  );

  const rows = scores
    .filter((s) => !excluded.has(s.job_posting_id) && openById.has(s.job_posting_id))
    .slice(0, room)
    .map((s) => ({
      user_id: userId,
      job_posting_id: s.job_posting_id,
      match_score: s.score,
      tier: s.tier,
      source_type: openById.get(s.job_posting_id)!.source_type,
      status: "pending" as const,
    }));

  if (!rows.length) return { queued: 0, skippedBelowThreshold: 0, reason: "nothing_new" };

  // Ignore duplicates rather than failing the whole scan: two concurrent feed
  // loads racing to queue the same job is normal, not an error.
  const { error: insertErr } = await admin
    .from("auto_apply_queue")
    .upsert(rows, { onConflict: "user_id,job_posting_id", ignoreDuplicates: true });
  if (insertErr) throw new Error(`Couldn't queue matches: ${insertErr.message}`);

  return { queued: rows.length, skippedBelowThreshold: 0 };
}
