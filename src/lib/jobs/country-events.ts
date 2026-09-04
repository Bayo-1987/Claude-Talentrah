import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/lib/supabase/types";

type EventType = Database["public"]["Tables"]["country_default_events"]["Row"]["event_type"];
export type CountryState = Database["public"]["Tables"]["country_default_events"]["Row"]["country_state"];

/**
 * Records one funnel event for Stage 12's country default: a feed load, a
 * job-detail-page view (an explicit, approximate stand-in for "click-through"
 * — see 0091's own migration comment for why this codebase has no real
 * click beacon to attach to yet), or an apply.
 *
 * Same shape and same reasoning as logCreditGateEvent
 * (src/lib/credits/gate-events.ts): written via the service-role client so it
 * can't be forged by the user it describes, and deliberately best-effort — a
 * dropped analytics row must never turn into a broken feed or a failed apply.
 */
/**
 * READING THE FUNNEL (no dashboard, same convention as gate-events.ts). Run
 * in the Supabase SQL editor.
 *
 * Apply rate by country_state — the number that decides whether defaulting
 * the feed to a user's own country was worth doing:
 *
 *   select
 *     fv.country_state,
 *     count(distinct fv.user_id)                                   as users_with_feed_view,
 *     count(distinct a.user_id)                                    as users_who_applied,
 *     round(100.0 * count(distinct a.user_id)
 *           / nullif(count(distinct fv.user_id), 0), 1)            as apply_rate_pct
 *   from country_default_events fv
 *   left join country_default_events a
 *     on a.user_id = fv.user_id
 *    and a.event_type = 'apply'
 *    and a.created_at >= fv.created_at
 *    and a.created_at <  fv.created_at + interval '1 day'
 *   where fv.event_type = 'feed_view'
 *   group by fv.country_state
 *   order by apply_rate_pct desc;
 *
 * Click-through (feed_view -> detail_view) by the same split — remember
 * detail_view is an approximation, not a real feed-card click:
 *
 *   select
 *     event_type, country_state, count(*) as events, count(distinct user_id) as users
 *   from country_default_events
 *   group by 1, 2
 *   order by 1, 2;
 */
export async function logCountryDefaultEvent(params: {
  userId: string;
  eventType: EventType;
  countryState: CountryState;
  jobPostingId?: string | null;
  tab?: string | null;
}): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from("country_default_events").insert({
      user_id: params.userId,
      event_type: params.eventType,
      country_state: params.countryState,
      job_posting_id: params.jobPostingId ?? null,
      tab: params.tab ?? null,
    });
    if (error) {
      console.error(`[country-events] failed to log ${params.eventType}/${params.countryState}: ${error.message}`);
    }
  } catch (err) {
    console.error(
      `[country-events] failed to log ${params.eventType}/${params.countryState}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
