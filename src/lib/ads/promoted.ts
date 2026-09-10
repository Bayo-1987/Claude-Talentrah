import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * The seeker side of ad campaigns: which jobs are promoted for this person,
 * and recording that they were shown.
 */

export interface PromotedJob {
  jobPostingId: string;
  campaignId: string;
  matchScore: number;
}

/**
 * Slots per feed render. Two, per D2.
 *
 * Small on purpose: §6.2 asks for restrained density, and the feed's whole
 * claim is that its order means something. A page of paid slots would say the
 * opposite regardless of how each one is labelled.
 */
export const PROMOTED_SLOTS = 2;

/**
 * The floor a promoted job must clear.
 *
 * 60 is not arbitrary and not just the function's default: it is the bottom of
 * the match-tier system (Fair 60–69, Good 70–79, Excellent 80+). Below it a job
 * has no tier at all, so promoting one would put a card at the top of the feed
 * showing a score the design has no word for.
 *
 * Passed explicitly rather than relying on `promoted_jobs`' default, so the
 * reason lives next to the number instead of in a migration.
 */
export const PROMOTED_MIN_SCORE = 60;

/**
 * Promoted jobs for the CURRENT session's user.
 *
 * Called with the USER's client, deliberately. `promoted_jobs` derives the
 * seeker from `auth.uid()` and takes no user id — a service-role call would
 * have no session and correctly return nothing.
 *
 * MUST BE CALLED AFTER SCORING. The function joins `match_scores`, which the
 * feed computes on each render, so calling it earlier would filter against the
 * previous visit's scores — the same ordering constraint the Auto-Apply scan
 * has, and for the same reason.
 */
export async function fetchPromotedJobs(
  supabase: SupabaseClient<Database>,
  opts: { workTypes?: string[]; seniorities?: string[]; limit?: number } = {},
): Promise<PromotedJob[]> {
  /*
   * Widened to arrays alongside the feed's own move to multi-select work
   * type and seniority (0095) — D1 requires a promoted slot to satisfy every
   * filter the reader has active, and a reader can now have two of either
   * active at once. An empty array is passed through as `null` (0095's own
   * "no filter applied" sentinel), not `[]`: `= any('{}')` matches nothing at
   * all, which would have every promoted slot vanish the instant a caller
   * passed an empty array instead of omitting the filter.
   */
  const { data, error } = await supabase.rpc("promoted_jobs", {
    p_min_score: PROMOTED_MIN_SCORE,
    p_work_types: (opts.workTypes?.length ? opts.workTypes : null) as never,
    p_seniorities: (opts.seniorities?.length ? opts.seniorities : null) as never,
    p_limit: opts.limit ?? PROMOTED_SLOTS,
  });

  if (error) {
    // Non-fatal by design: promoted slots are an accessory to the feed, and an
    // ads failure must not take the job board down. Logged rather than
    // swallowed, because a silently empty promoted set is indistinguishable
    // from having no live campaigns — and that is the exact ambiguity that hid
    // the unbilled-campaign defect for weeks.
    console.error("[ads] promoted_jobs failed:", error.message);
    return [];
  }

  return (data ?? []).map((r) => ({
    jobPostingId: r.job_posting_id,
    campaignId: r.campaign_id,
    matchScore: r.match_score,
  }));
}

/**
 * Records that promoted jobs were rendered.
 *
 * D3: AN IMPRESSION HERE IS A SERVER RENDER, NOT A VIEWPORT. The card was
 * emitted into the page; whether the person scrolled to it is unknown. That
 * over-counts, and the surface value says so — `job_feed_render` rather than
 * `job_feed` — so whoever eventually bills on these can see what they actually
 * measure instead of inferring it. Deliberate: nothing bills per impression
 * today, and a beacon-based count is a client component and a public endpoint
 * for a number no invoice reads yet.
 *
 * `record_ad_event` dedupes impressions per user per campaign per DAY, which is
 * what keeps a re-render on every filter change from inflating the count.
 *
 * Service role because the RPC is service_role-only — an event log a client
 * could write to is an invoice a client could write.
 */
export async function recordPromotedImpressions(
  userId: string,
  promoted: PromotedJob[],
): Promise<void> {
  if (promoted.length === 0) return;
  const admin = createServiceRoleClient();

  await Promise.all(
    promoted.map(async (p) => {
      try {
        const { error } = await admin.rpc("record_ad_event", {
          p_campaign_id: p.campaignId,
          p_job_posting_id: p.jobPostingId,
          p_user_id: userId,
          p_event_type: "impression",
          p_surface: "job_feed_render",
        });
        if (error) console.error(`[ads] impression ${p.campaignId}: ${error.message}`);
      } catch (err) {
        console.error(`[ads] impression ${p.campaignId}:`, err);
      }
    }),
  );
}

/**
 * The other two-thirds of the funnel (0128) — impressions were the only
 * event type ever recorded before this. Shared by the click-recording API
 * route and the in-app apply action, so both funnel stages go through one
 * error-handling shape instead of three near-identical try/catches.
 *
 * Service role, same reasoning as `recordPromotedImpressions`: `record_ad_event`
 * is service_role-only EXECUTE (0052) precisely so no client-writable path can
 * author what is, in effect, an invoice line. Both of this function's callers
 * are themselves server-side (an API route, a Server Action) — the client
 * never gets a direct line to this.
 */
export async function recordAdEvent(params: {
  campaignId: string;
  jobPostingId: string;
  userId: string;
  eventType: "click" | "apply";
  surface: string;
}): Promise<void> {
  const admin = createServiceRoleClient();
  try {
    const { error } = await admin.rpc("record_ad_event", {
      p_campaign_id: params.campaignId,
      p_job_posting_id: params.jobPostingId,
      p_user_id: params.userId,
      p_event_type: params.eventType,
      p_surface: params.surface,
    });
    if (error) console.error(`[ads] ${params.eventType} ${params.campaignId}: ${error.message}`);
  } catch (err) {
    console.error(`[ads] ${params.eventType} ${params.campaignId}:`, err);
  }
}

/**
 * Whether ONE job posting currently has an active campaign, and if so which
 * one — used by the click-recording route (to validate a client-claimed
 * campaign id is real and current) and the apply action (to decide whether an
 * apply is attributable at all).
 *
 * Deliberately NOT `fetchPromotedJobs`/`promoted_jobs`: that RPC answers "is
 * this promoted FOR THIS SEEKER right now" — it requires a `match_scores` row
 * for the calling user and applies their active feed filters, which is the
 * right question for deciding what to SHOW, and the wrong one for deciding
 * whether a click or apply that already happened should be attributed to a
 * campaign. This answers the narrower, campaign-only question directly.
 *
 * Service role: `ad_campaigns` is org-members-only readable (0047), and
 * neither caller has an org session — a seeker applying, or an unauthenticated
 * validation check, has no route to this table otherwise.
 *
 * If more than one active campaign somehow targets the same posting (nothing
 * in 0047 prevents it, though normal use never creates it), this returns
 * whichever the query happens to return first — the same "no dedup across
 * campaigns" behaviour `promoted_jobs` itself already has, not a new gap.
 */
export async function findActiveCampaignForJobPosting(jobPostingId: string): Promise<string | null> {
  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from("ad_campaigns")
    .select("id")
    .eq("job_posting_id", jobPostingId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`[ads] active-campaign lookup for ${jobPostingId} failed:`, error.message);
    return null;
  }
  return data?.id ?? null;
}
