import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * The course catalog, for the admin screen.
 *
 * 0061 named this gap in its own header — "adding a row is a SQL insert until
 * the admin dashboard grows a screen for it" — and this is that screen's read
 * side.
 *
 * NOT A MODERATION QUEUE, and it is shaped differently on purpose. The other
 * three screens show work waiting to be decided and empty as an operator
 * clears them. This is a small hand-curated list that is never "done": it
 * shows EVERY row, active and inactive, because the inactive ones are the
 * point. The public matcher filters `active = true`; this screen must not, or
 * an operator would be unable to see the nine rows 0063 switched off, let
 * alone turn them back on.
 */

/** The marker 0063 used to identify rows nobody has curated yet. */
export const PLACEHOLDER_MARKER = "ref=talentrah-placeholder";

export { PRICE_TIERS, type PriceTier } from "./constants";

export interface CourseRow {
  id: string;
  skillTag: string;
  provider: string;
  title: string;
  affiliateUrl: string;
  priceTier: string;
  active: boolean;
  updatedAt: string;
  /** True while the affiliate link is still the un-earning placeholder. */
  isPlaceholder: boolean;
  /** Outbound clicks recorded against this row, all time. */
  clicks: number;
}

export async function courseCatalog(): Promise<CourseRow[]> {
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("course_recommendations")
    .select("id, skill_tag, provider, title, affiliate_url, price_tier, active, updated_at")
    // Inactive first: they are the rows that need attention, and on a
    // nine-row table putting the actionable ones at the top costs nothing.
    // Then by skill so the list reads as a catalog rather than a log.
    .order("active", { ascending: true })
    .order("skill_tag", { ascending: true });
  if (error) throw error;

  /*
   * Click counts come from a second query and are grouped here rather than
   * joined. PostgREST cannot express "count per recommendation" without a view
   * or an RPC, and putting this screen's shape into a migration would mean
   * another migration to change it — the same call `reportedPostings()` makes,
   * for the same reason, at a volume where it is free.
   *
   * `course_recommendation_clicks` is telemetry about people, so only the
   * COUNT crosses into this module. No user ids, no timestamps per person.
   */
  const { data: clicks, error: clickError } = await supabase
    .from("course_recommendation_clicks")
    .select("recommendation_id");
  if (clickError) throw clickError;

  const clicksByRow = new Map<string, number>();
  for (const c of clicks ?? []) {
    if (!c.recommendation_id) continue; // survives its catalog row being deleted
    clicksByRow.set(c.recommendation_id, (clicksByRow.get(c.recommendation_id) ?? 0) + 1);
  }

  return (data ?? []).map((r) => ({
    id: r.id,
    skillTag: r.skill_tag,
    provider: r.provider,
    title: r.title,
    affiliateUrl: r.affiliate_url,
    priceTier: r.price_tier,
    active: r.active,
    updatedAt: r.updated_at,
    isPlaceholder: r.affiliate_url.includes(PLACEHOLDER_MARKER),
    clicks: clicksByRow.get(r.id) ?? 0,
  }));
}

/**
 * What the nav badge counts: rows still carrying a placeholder affiliate link.
 *
 * Deliberately NOT the row count. Every other badge means "this much is
 * waiting", and a catalog has nothing waiting — but an un-curated affiliate
 * link IS outstanding work (§10 item 1, a founder action). This number
 * therefore stays at 9 until real codes exist and then falls to 0, which is
 * exactly the behaviour the other badges have.
 */
export async function placeholderCourseCount(): Promise<number> {
  const supabase = createServiceRoleClient();
  const { count, error } = await supabase
    .from("course_recommendations")
    .select("id", { count: "exact", head: true })
    .like("affiliate_url", `%${PLACEHOLDER_MARKER}%`);
  if (error) throw error;
  return count ?? 0;
}
