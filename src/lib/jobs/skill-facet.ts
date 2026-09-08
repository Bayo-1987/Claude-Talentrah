import type { Tables } from "@/lib/supabase/types";

/**
 * Reading the skills parsed out of a job posting's text.
 *
 * NOT A MAINTAINED TAXONOMY. Every value comes from `structured_jd.skills`,
 * which the aggregation pipeline (§6.12) already parses out of the posting
 * text for match scoring — the same array the score on each card is computed
 * against. Nothing here is curated.
 *
 * FORMERLY ALSO THE FEED'S SKILL FACET — computeSkillFacet/filterBySkill and
 * the twelve-chip browse row they powered were removed from the jobs feed:
 * search (src/lib/jobs/search.ts) now covers `structured_jd.skills` directly,
 * which was the facet's whole reason to exist as UI ("mentioned in the job
 * text" is now something the search box itself answers). This file shrinks to
 * just `skillsOf`, which stays load-bearing for two other callers: the search
 * haystack, and the job detail page's own "Skills named in this posting"
 * card.
 */

// Pick, not the full row: skillsOf only ever reads structured_jd. Narrowed
// from the previous Omit<> (still a huge required shape) so the jobs feed's
// lightweight board-aggregate query (jobs/page.tsx's boardAggregateQuery,
// added for Recent-tab pagination) — which selects only a handful of
// columns, not a full posting row — can call this too. A Pick only widens
// what's ACCEPTED, so every existing caller passing a full row keeps typing
// fine.
type JobPosting = Pick<Tables<"job_postings">, "structured_jd">;

/** Reads the skills array off a posting, tolerating the 5 rows that lack one. */
export function skillsOf(job: JobPosting): string[] {
  const raw = (job.structured_jd as { skills?: unknown } | null)?.skills;
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string").map((s) => s.toLowerCase());
}
