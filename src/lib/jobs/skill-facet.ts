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
 * Those are suppressed by SKILL_FACET_MAX_SHARE below — by how much of the
 * board they match, not by anyone deciding they are "not real skills". Counts
 * are still rendered beside every surviving chip, because share is a blunt
 * instrument and a user should be able to see what a filter will cost them.
 */

// Omit, not the full row: the signed-in feed (jobs/page.tsx) is this
// function's only real caller and fetches `description` pre-truncated via
// the generated `description_preview` column (migration 0086), never the
// raw preview column itself — the wider Omit<> still accepts any full row
// another caller might pass.
type JobPosting = Omit<Tables<"job_postings">, "description_preview">;

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

/**
 * A skill matching more than this share of the board is dropped from the facet.
 *
 * WHY A SHARE AND NOT A CURATED LIST. The three most common parsed values are
 * `communication`, `operations` and `leadership` — none of which is what anyone
 * means by a skill filter, and all of which would sit at the top of a
 * count-ordered facet. The obvious fix is an allowlist of "real" technologies,
 * and it is the wrong one: it is a taxonomy someone has to maintain, it goes
 * stale the moment a new tool appears, and it re-introduces exactly the
 * hand-curated category list this facet exists to replace.
 *
 * A share threshold gets the same result from the data itself. A filter that
 * matches most of the board does not filter — that is true of `communication`
 * at 55% and would be equally true of `react` if the board were all frontend
 * roles. The rule survives the corpus changing; a list of tech names does not.
 *
 * 0.30 measured against production, not picked for roundness. On the 150 open
 * postings it removes exactly three values — communication (55%), operations
 * (45%), leadership (33%) — and nothing else: the next value down is `sql` at
 * 25%, so the threshold has real clearance on both sides rather than slicing
 * through the middle of the distribution.
 *
 * It is a share, so it also adjusts as the board does. On a filtered board of
 * twenty backend roles, `python` may well exceed 30% and drop out — correctly,
 * because at that point it no longer tells the user anything.
 */
export const SKILL_FACET_MAX_SHARE = 0.3;

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
  // Share is of the whole board the facet was computed against, including the
  // postings that carry no skills at all — they are still jobs a filter would
  // hide, so they belong in the denominator.
  const ceiling = jobs.length * SKILL_FACET_MAX_SHARE;
  return [...counts.entries()]
    .filter(([, count]) => count <= ceiling)
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
