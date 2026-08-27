import type { Tables } from "@/lib/supabase/types";

/**
 * The feed's skill facet, derived from postings already ingested.
 *
 * NOT A MAINTAINED TAXONOMY. Every value comes from `structured_jd.skills`,
 * which the aggregation pipeline (§6.12) already parses out of the posting
 * text for match scoring — the same array the score on each card is computed
 * against. Nothing here is curated, and no list needs updating when a new
 * technology appears in the market: it shows up when a posting mentions it.
 *
 * MEASURED BEFORE BUILDING, against the 150 open postings in production:
 *
 *   145 of 150 carry a non-empty skills array
 *   42 distinct values, all stored lowercase, no casing variants
 *   coverage across every source — greenhouse 124, workable 19, internal 2
 *
 * WHAT THAT DATA ALSO SHOWED, and why counts are rendered rather than hidden:
 * the parsed values are NOT predominantly technologies. The three most common
 * are `communication` (83), `operations` (67) and `leadership` (50) — matching
 * 55%, 45% and 33% of the board. `sql`, the example in the mock, is fourth at
 * 38.
 *
 * Excluding the soft skills would mean inventing exactly the taxonomy this
 * facet exists to avoid, so they stay. Showing each count alongside the label
 * is the honest alternative: a chip that narrows the board by half says so on
 * its face, and the user can decide whether it is worth clicking.
 */

type JobPosting = Tables<"job_postings">;

export interface SkillFacetEntry {
  skill: string;
  count: number;
}

/**
 * How many skills the feed offers.
 *
 * Twelve of forty-two. All of them is a wall of links on a screen whose whole
 * argument is lower density, and the tail is thin enough that it would be a
 * wall of ones — 12 of the 42 values appear in three postings or fewer.
 */
export const SKILL_FACET_SIZE = 12;

/** Reads the skills array off a posting, tolerating the 5 rows that lack one. */
export function skillsOf(job: JobPosting): string[] {
  const raw = (job.structured_jd as { skills?: unknown } | null)?.skills;
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string").map((s) => s.toLowerCase());
}

/**
 * Counts skills across the postings the feed is about to show.
 *
 * COUNTED BEFORE THE SKILL FILTER IS APPLIED, deliberately. Counting after
 * would collapse every other skill to whatever co-occurs with the selected
 * one, so the facet would appear to empty out the moment it was used — the
 * classic self-defeating filter. Work-type and seniority ARE already applied,
 * which is intentional the other way: those counts should reflect the board
 * the user is actually looking at.
 */
export function computeSkillFacet(jobs: JobPosting[], size = SKILL_FACET_SIZE): SkillFacetEntry[] {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    // A posting listing the same skill twice must count once, or a sloppy
    // parse inflates the facet.
    for (const skill of new Set(skillsOf(job))) {
      counts.set(skill, (counts.get(skill) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([skill, count]) => ({ skill, count }))
    // Count first, then alphabetical — so the order is stable between renders
    // rather than depending on Map insertion, which follows posting order.
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
    .slice(0, size);
}

/** Postings mentioning `skill`. Case-insensitive; stored values are lowercase. */
export function filterBySkill(jobs: JobPosting[], skill: string | undefined): JobPosting[] {
  if (!skill) return jobs;
  const wanted = skill.toLowerCase();
  return jobs.filter((job) => skillsOf(job).includes(wanted));
}
