import type { Tables } from "@/lib/supabase/types";

type JobPosting = Tables<"job_postings">;

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
 * round trip. Same reasoning as the skill facet, and the same caveat: it stops
 * being true if the board grows enough to need paging, and the search moves
 * into the query then, with a properly parameterised full-text column rather
 * than a hand-escaped `or`.
 *
 * WHAT IT SEARCHES: title, company, location. Not the description — a
 * substring match against thousands of words of boilerplate returns almost
 * everything and reads as a broken filter. The skill facet already covers
 * "mentioned in the job text" with counts that tell you how blunt each term
 * is.
 */
export function searchJobs(jobs: JobPosting[], query: string | undefined): JobPosting[] {
  const q = query?.trim().toLowerCase();
  if (!q) return jobs;

  return jobs.filter((job) => {
    const haystack = [job.title, job.company_name, job.location]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}
