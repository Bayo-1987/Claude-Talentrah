import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Finding a specific posting to remove it, independent of whether anyone has
 * reported it.
 *
 * WHY THIS IS NOT `reportedPostings()` WITH A FILTER ADDED. That function's
 * whole shape — an inner join on `job_posting_reports`, grouped and ranked by
 * distinct reporters — only produces rows for postings someone has already
 * flagged. An admin who personally spots a suspicious listing needs the
 * opposite: reach ANY live posting by name, whether or not it has ever been
 * reported. Bolting a search filter onto the reports query would still only
 * search WITHIN the reported set.
 *
 * EXCLUDES `removed` POSTINGS, same as `reportedPostings()` — a posting
 * already taken down belongs on `/admin/reports`'s own "Removed from the
 * board" list (where Restore actually lives), not in a search meant to find
 * something to remove.
 *
 * THREE SEPARATE ILIKE QUERIES, MERGED IN JS, RATHER THAN ONE `.or()` STRING.
 * A `.or()` filter is a raw string PostgREST parses on commas and dots —
 * interpolating a searcher's own free-text query straight into that string
 * means a comma or parenthesis they type breaks the filter's syntax, not just
 * the search. Three plain, parameterised `.ilike()` calls sidestep that
 * entirely, at the cost of extra round trips this table's volume makes free
 * (same trade `reportedPostings()`'s own header already makes for its
 * in-JS grouping).
 *
 * "Organisation" is searched by joining to the CURRENT `organizations.name`,
 * not by re-searching `company_name` a second time — `company_name` is a
 * copy taken at posting time, so a renamed organisation's own new name would
 * otherwise not find its older postings.
 */
export interface SearchedPosting {
  jobPostingId: string;
  title: string;
  company: string;
  status: string;
  sourceType: string;
  externalUrl: string | null;
  location: string | null;
  postedAt: string;
  organizationName: string | null;
}

/** Hard cap on what one search/browse returns — a search tool, not an export. */
const RESULT_LIMIT = 50;

const SELECT_COLUMNS =
  "id, title, company_name, status, source_type, external_url, location, posted_at, organizations(name)";

type Row = {
  id: string;
  title: string;
  company_name: string;
  status: string;
  source_type: string;
  external_url: string | null;
  location: string | null;
  posted_at: string;
  organizations: { name: string } | null;
};

function toSearchedPosting(r: Row): SearchedPosting {
  return {
    jobPostingId: r.id,
    title: r.title,
    company: r.company_name,
    status: r.status,
    sourceType: r.source_type,
    externalUrl: r.external_url,
    location: r.location,
    postedAt: r.posted_at,
    organizationName: r.organizations?.name ?? null,
  };
}

/**
 * `query` empty or blank means "browse" — the most recently posted live
 * postings, no filter — so this page is useful before an admin has typed
 * anything, not just after.
 */
export async function searchJobPostings(query: string): Promise<SearchedPosting[]> {
  const supabase = createServiceRoleClient();
  const q = query.trim();

  if (!q) {
    const { data, error } = await supabase
      .from("job_postings")
      .select(SELECT_COLUMNS)
      .neq("status", "removed")
      .order("posted_at", { ascending: false })
      .limit(RESULT_LIMIT);
    if (error) throw error;
    return ((data ?? []) as Row[]).map(toSearchedPosting);
  }

  const like = `%${q}%`;

  const { data: matchingOrgs, error: orgError } = await supabase
    .from("organizations")
    .select("id")
    .ilike("name", like);
  if (orgError) throw orgError;
  const orgIds = (matchingOrgs ?? []).map((o) => o.id);

  const queries = [
    supabase
      .from("job_postings")
      .select(SELECT_COLUMNS)
      .neq("status", "removed")
      .ilike("title", like)
      .order("posted_at", { ascending: false })
      .limit(RESULT_LIMIT),
    supabase
      .from("job_postings")
      .select(SELECT_COLUMNS)
      .neq("status", "removed")
      .ilike("company_name", like)
      .order("posted_at", { ascending: false })
      .limit(RESULT_LIMIT),
  ];
  if (orgIds.length > 0) {
    queries.push(
      supabase
        .from("job_postings")
        .select(SELECT_COLUMNS)
        .neq("status", "removed")
        .in("organization_id", orgIds)
        .order("posted_at", { ascending: false })
        .limit(RESULT_LIMIT),
    );
  }

  const results = await Promise.all(queries);
  for (const r of results) if (r.error) throw r.error;

  const byId = new Map<string, SearchedPosting>();
  for (const r of results) {
    for (const row of (r.data ?? []) as Row[]) {
      byId.set(row.id, toSearchedPosting(row));
    }
  }

  return [...byId.values()]
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
    .slice(0, RESULT_LIMIT);
}
