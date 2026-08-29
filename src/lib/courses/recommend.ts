import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { GapAnalysisItem } from "@/lib/tailoring/types";
import { rankCourseRecommendations, type RankedRecommendation, type CourseRow } from "./match";

/**
 * The catalog query, kept apart from the ranking so the ranking stays pure.
 *
 * M1 deliberately left `rankCourseRecommendations` with no database access —
 * fixtures in, ranked rows out — and that is worth preserving, because it is
 * what lets the ordering rules be tested exhaustively without a project to
 * point at. This module is the other half: it decides what "the catalog" means
 * for a request, and nothing else.
 *
 * ── WHY `active` IS FILTERED HERE AND NOT ONLY IN THE RANKER ──────────────
 *
 * Both do it, on purpose. 0061's read policy is `for select using (true)`, so
 * a plain select returns retired rows too — the soft-delete flag is not a
 * privacy boundary and the policy does not pretend otherwise. Filtering in SQL
 * means a retired course is not fetched at all rather than fetched and
 * discarded, and the partial index `course_recommendations_skill_idx ... where
 * active` is built for exactly that shape. The ranker's own `active !== false`
 * guard stays because it protects callers who pass a hand-built catalog.
 */

/**
 * Ranked recommendations for a gap analysis, or an empty list.
 *
 * NEVER THROWS, and that is the important property rather than a defensive
 * habit. By the time this is called the user has already been charged for a
 * tailoring run and the model has already produced a result; a failed catalog
 * query must cost them a suggestion, not the thing they paid for. So a
 * database error is logged and read as "no recommendations", which is also a
 * real and common answer — most gap analyses contain nothing the nine-row
 * catalog covers, and the M1 tests pin that as correct behaviour rather than a
 * degraded one.
 *
 * The distinction that would matter if this ever gated anything: an error here
 * is indistinguishable from an empty catalog to the caller. That is acceptable
 * only because the output is advisory. Do not reuse this shape for anything
 * that decides access or money — CLAUDE.md's "an error is not an absence" rule
 * applies the moment the answer stops being a suggestion.
 */
export async function recommendCoursesForGapAnalysis(
  supabase: SupabaseClient<Database>,
  gapAnalysis: GapAnalysisItem[],
  limit = 2,
): Promise<RankedRecommendation[]> {
  // Nothing missing means nothing to recommend, and no reason to ask the
  // database. The ranker would return [] anyway; this just avoids the trip.
  if (!gapAnalysis.some((item) => item.status === "missing")) return [];

  const { data, error } = await supabase
    .from("course_recommendations")
    .select("id, skill_tag, provider, title, affiliate_url, price_tier, active")
    .eq("active", true);

  if (error) {
    console.error("[courses] catalog query failed, continuing without recommendations:", error);
    return [];
  }

  return rankCourseRecommendations(gapAnalysis, (data ?? []) as CourseRow[], { limit });
}
