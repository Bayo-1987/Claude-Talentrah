import type { Tables } from "@/lib/supabase/types";
import { skillsOf } from "./skill-facet";

// See skill-facet.ts's identical alias for why this is Omit, not the full row.
type JobPosting = Omit<Tables<"job_postings">, "description_preview">;

/**
 * Free-text search over the board already in memory.
 *
 * IN MEMORY, NOT A POSTGREST FILTER, and that is a security decision rather
 * than a performance one. The natural implementation is
 * `.or("title.ilike.%q%,company_name.ilike.%q%")` — and PostgREST's `or`
 * takes a filter EXPRESSION as a string, so raw user input becomes part of the
 * query grammar. A `q` containing a comma, a parenthesis or a dot changes what
 * is being asked, not just what is matched. There is no parameter binding to
 * hide behind, and escaping a grammar by hand is the wrong side of a bet to be
 * on for a search box.
 *
 * The feed already fetches its whole result set — there is no pagination — so
 * this filters roughly 150 rows already in hand rather than making a second
 * round trip. Same reasoning as the skill facet used to be, and the same
 * caveat: it stops being true if the board grows enough to need paging, and
 * the search moves into the query then, with a properly parameterised
 * full-text column rather than a hand-escaped `or`.
 *
 * WHAT IT SEARCHES: title, company, location, and — as of the skill facet's
 * removal from the feed UI — `structured_jd.skills` via the same `skillsOf()`
 * the facet used to render from. That used to be the facet's job: with it
 * gone, a search box that stops at title/company/location is the only surface
 * left that can answer "python" or "kubernetes" at all, and measured on
 * production against open postings, `excel` matched 55 postings by skill and
 * 0 by this search, `sql` 44 vs. 0, `python` 38 vs. 0, `kubernetes` 16 vs. 0 —
 * a reader typing an exact, correct term for what a role asks for got an
 * empty board. Still NOT the full description: thousands of words of
 * boilerplate would make a substring match return almost everything and read
 * as a broken filter. `structured_jd.skills` is the parsed, bounded middle
 * ground — real content coverage without searching prose.
 */
export function searchJobs(jobs: JobPosting[], query: string | undefined): JobPosting[] {
  const q = query?.trim().toLowerCase();
  if (!q) return jobs;

  return jobs.filter((job) => {
    const haystack = [job.title, job.company_name, job.location, ...skillsOf(job)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}
