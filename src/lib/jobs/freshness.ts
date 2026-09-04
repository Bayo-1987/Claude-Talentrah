import type { Tables } from "@/lib/supabase/types";
import { relativeDayLabel, formatRelativeTime } from "@/lib/format-relative-time";

/**
 * The ambient freshness ceiling — no open posting older than this by
 * `posted_at` is ever shown to a seeker or a crawler, on any discovery
 * surface (the authenticated feed, both SEO landing pages, the sitemap, the
 * job detail page reached by direct URL, and Auto-Apply's own candidate
 * scan). 93 postings qualify today and the number grows daily as the board
 * ages — this is a VISIBILITY floor, not a deletion: every row this excludes
 * still exists and is untouched (Stage 5b is the separate, not-yet-started
 * deletion job).
 *
 * Every query that lists postings for discovery needs this applied
 * independently — there is no single choke point all of them pass through
 * (confirmed by reading every call site before writing this). Import
 * `freshnessFloorISO()` and add `.gte("posted_at", freshnessFloorISO())`
 * anywhere a NEW discovery query is added; a page rendering a user's OWN
 * history (Job Tracker, Auto-Apply's review queue, the Tailor page for a
 * specific job) is a different kind of page and must NOT get this filter —
 * hiding someone's own applied-to job because it aged out would be a
 * regression, not a feature.
 */
export const JOB_FRESHNESS_WINDOW_DAYS = 30;

export function freshnessFloorISO(now: number = Date.now()): string {
  return new Date(now - JOB_FRESHNESS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The optional, user-chosen narrower windows layered on top of the ambient
 * 30-day floor — "Past 24 hours" through "Past month". "month" is not a
 * typo for a no-op: it is deliberately equal to `JOB_FRESHNESS_WINDOW_DAYS`,
 * so choosing it explicitly states the same boundary the floor already
 * enforces rather than the UI silently offering a control that does nothing
 * once the floor exists.
 */
export const JOB_DATE_FILTERS = ["24h", "3d", "week", "month"] as const;
export type JobDateFilter = (typeof JOB_DATE_FILTERS)[number];

export const JOB_DATE_FILTER_DAYS: Record<JobDateFilter, number> = {
  "24h": 1,
  "3d": 3,
  week: 7,
  month: JOB_FRESHNESS_WINDOW_DAYS,
};

export const JOB_DATE_FILTER_LABEL: Record<JobDateFilter, string> = {
  "24h": "Past 24 hours",
  "3d": "Past 3 days",
  week: "Past week",
  month: "Past month",
};

export function isJobDateFilter(value: string | undefined | null): value is JobDateFilter {
  return !!value && (JOB_DATE_FILTERS as readonly string[]).includes(value);
}

/**
 * The actual cutoff a query should use: the user's chosen window if they
 * picked one, otherwise just the ambient floor. Capped at the floor either
 * way — a caller cannot pass a filter that reaches further back than 30
 * days, so a future bug that widened `JOB_DATE_FILTER_DAYS` past the floor
 * could not silently resurrect an excluded posting through the date filter.
 */
export function jobDateFilterSinceISO(filter: JobDateFilter | undefined, now: number = Date.now()): string {
  const requestedDays = filter ? JOB_DATE_FILTER_DAYS[filter] : JOB_FRESHNESS_WINDOW_DAYS;
  const cappedDays = Math.min(requestedDays, JOB_FRESHNESS_WINDOW_DAYS);
  return new Date(now - cappedDays * 24 * 60 * 60 * 1000).toISOString();
}

type AgeLineInput = Pick<Tables<"job_postings">, "source_type" | "posted_at" | "last_checked_at">;

/**
 * "Posted 2 days ago · re-verified today" — the single, always-shown line
 * this replaces src/lib/jobs/freshness-note.ts's `freshnessNote` with.
 *
 * That function only ever fired past 120 days, reasoning that a fresh
 * listing is self-explanatory. It stops being reachable at all once nothing
 * older than 30 days is ever displayed — the ambient floor above makes the
 * whole "old enough to need an explanation" question moot. What replaces it
 * is the product's actual freshness thesis stated plainly on every card,
 * not just the rare stale one: "posted" is a fact about the LISTING,
 * "re-verified" is a fact about the SOURCE (the daily ingest's
 * `last_checked_at`, written only when a fetch affirmatively re-confirmed
 * the posting — see the deleted freshnessNote's own header for why
 * `status = 'open'` alone can't support that second claim). Internal
 * postings have no external source to re-confirm, so they show only the
 * first half — reporting our own record back as if it were third-party
 * confirmation would be circular, the same reasoning freshnessNote used.
 */
export function postingAgeLine(job: AgeLineInput, now: number = Date.now()): string {
  const posted = formatRelativeTime(job.posted_at, now);
  if (job.source_type !== "external" || !job.last_checked_at) return posted;
  return `${posted} · re-verified ${relativeDayLabel(job.last_checked_at, now)}`;
}
