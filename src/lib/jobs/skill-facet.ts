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

// Omit, not the full row: the signed-in feed (jobs/page.tsx) is this
// function's only real caller and fetches `description` pre-truncated via
// the generated `description_preview` column (migration 0086), never the
// raw preview column itself — the wider Omit<> still accepts any full row
// another caller might pass.
type JobPosting = Omit<Tables<"job_postings">, "description_preview">;

/** Reads the skills array off a posting, tolerating the 5 rows that lack one. */
export function skillsOf(job: JobPosting): string[] {
  const raw = (job.structured_jd as { skills?: unknown } | null)?.skills;
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string").map((s) => s.toLowerCase());
}
