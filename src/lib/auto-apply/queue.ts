import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  AUTO_APPLY_DAILY_SUBMIT_CAP,
  AUTO_APPLY_FREE_PER_WEEK,
  AUTO_APPLY_MAX_PENDING,
  AUTO_APPLY_MIN_SCORE,
} from "./config";

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

  return {
    submittedLast24h,
    submittedLast7d,
    dailyRemaining,
    freeRemaining,
    nextSubmissionCostsCredits: freeRemaining === 0,
  };
}

export interface ScanResult {
  queued: number;
  skippedBelowThreshold: number;
  reason?: string;
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
    admin
      .from("job_postings")
      .select("id, source_type, status")
      .in("id", jobIds)
      .eq("status", "open"),
  ]);

  const excluded = new Set([
    ...(existingApps ?? []).map((a) => a.job_posting_id),
    ...(alreadyQueued ?? []).map((q) => q.job_posting_id),
  ]);
  const openById = new Map((openJobs ?? []).map((j) => [j.id, j]));

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
