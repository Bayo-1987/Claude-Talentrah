/**
 * The feed's Saved tab as ONE set: every tracker application at stage "saved" (send-496, S11).
 *
 * There is no separate saved-jobs table. The heart (toggleSaveAction) writes the tracker row, so the data model was
 * already unified; the Saved tab was FILTERING that set the way it filters the discovery feed (status = open, a
 * 30-day freshness floor, the country default). Measured on production, all five of the owner's saved rows pointed at
 * postings that had since closed. The earlier note in jobs/(feed)/page.tsx, "a saved-but-aged-out posting disappearing
 * from THIS tab does not lose anything: /tracker shows every stage", is the decision this overturns.
 *
 * Everything pure about that lives here so it can be tested without rendering the feed page: which saved rows are open
 * postings (the normal job card), which become a snapshot-backed entry (closed, removed, manual), the query that fetches
 * a saved set without the discovery filters, the search rule for entries, and the one-empty-state rule.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type WorkType = Database["public"]["Enums"]["work_type"];
type Seniority = Database["public"]["Enums"]["seniority_level"];

/** A saved row that is not an open posting, ready to render (SavedEntryCard). */
export interface SavedEntry {
  applicationId: string;
  /** null for a manual tracker entry, which never had a posting. */
  jobPostingId: string | null;
  /** "closed": there was a posting and it is no longer open/readable. "manual": the user added it themselves. */
  kind: "closed" | "manual";
  title: string;
  companyName: string;
  location?: string;
  url?: string;
}

export interface SavedApplicationRow {
  id: string;
  job_posting_id: string | null;
  manual_job_snapshot: unknown;
}

export interface SavedPostingLite {
  id: string;
  status: string;
  title: string;
  company_name: string;
  location: string | null;
  external_url: string | null;
}

/** A well-formed snapshot (the shape job-snapshot.ts and addManualEntryAction write), or null for anything else. */
function readSnapshot(raw: unknown): { companyName: string; title: string; location?: string; url?: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.title !== "string" || !s.title.trim()) return null;
  return {
    title: s.title,
    companyName: typeof s.companyName === "string" ? s.companyName : "",
    location: typeof s.location === "string" && s.location ? s.location : undefined,
    url: typeof s.url === "string" && s.url ? s.url : undefined,
  };
}

/**
 * Splits the saved rows into the open postings (left to the normal job card; only their ids are returned) and the
 * entries that need a card of their own.
 *
 * - A posting that is present and not open becomes a closed entry carrying the posting's own fields.
 * - A posting the viewer cannot read any more (removed) falls back to the snapshot taken when it was saved.
 * - A manual entry (no posting) renders from its snapshot.
 * - A row with no usable snapshot still gets an entry with a generic title, so it can be seen and removed. A saved row
 *   that vanished from the tab would still be sitting in the tracker, which is the ghost this exists to prevent.
 *
 * `snapshotOnly: false` drops the entries that exist only because no posting was fetched. It is for when the user has
 * a work-type, seniority or "posted within" filter on: those are applied in the database query, so a posting that is
 * merely absent from the result may simply not match the filter, and a snapshot cannot prove it does. Showing it as
 * "closed" then would be wrong.
 */
export function partitionSavedSet(
  rows: readonly SavedApplicationRow[],
  postings: readonly SavedPostingLite[],
  options: { snapshotOnly?: boolean } = {},
): { openPostingIds: string[]; entries: SavedEntry[] } {
  const snapshotOnly = options.snapshotOnly ?? true;
  const byId = new Map(postings.map((p) => [p.id, p]));
  const openPostingIds: string[] = [];
  const entries: SavedEntry[] = [];

  for (const row of rows) {
    const posting = row.job_posting_id ? byId.get(row.job_posting_id) : undefined;

    if (posting) {
      if (posting.status === "open") {
        openPostingIds.push(posting.id);
      } else {
        entries.push({
          applicationId: row.id,
          jobPostingId: posting.id,
          kind: "closed",
          title: posting.title,
          companyName: posting.company_name,
          location: posting.location || undefined,
          url: posting.external_url || undefined,
        });
      }
      continue;
    }

    if (!snapshotOnly) continue;
    const snapshot = readSnapshot(row.manual_job_snapshot);
    const manual = row.job_posting_id === null;
    entries.push({
      applicationId: row.id,
      jobPostingId: row.job_posting_id,
      kind: manual ? "manual" : "closed",
      title: snapshot?.title ?? (manual ? "A job you added" : "A job that is no longer available"),
      companyName: snapshot?.companyName ?? "",
      ...(snapshot?.location ? { location: snapshot.location } : {}),
      ...(snapshot?.url ? { url: snapshot.url } : {}),
    });
  }

  return { openPostingIds, entries };
}

/**
 * The search box over snapshot-backed entries: one case-insensitive substring over title, company and location. The
 * same rule `searchJobs` (lib/jobs/search.ts) applies to postings, minus the skills it reads from structured_jd (an
 * entry has none).
 */
export function entryMatchesQuery(
  entry: { title: string; companyName: string; location?: string },
  q: string | undefined,
): boolean {
  const needle = q?.trim().toLowerCase();
  if (!needle) return true;
  return [entry.title, entry.companyName, entry.location].filter(Boolean).join(" ").toLowerCase().includes(needle);
}

/**
 * The Saved tab's ONE empty state. "none": nothing is saved. "filtered": there is a saved set and the user's own
 * filters or search hide all of it. Never both, and never alongside a country notice (the tab has no country filter).
 */
export function savedEmptyState(input: { savedTotal: number; shown: number }): "none" | "filtered" | null {
  if (input.shown > 0) return null;
  return input.savedTotal === 0 ? "none" : "filtered";
}

/**
 * The most saved jobs the Saved tab loads (send-496). A user can save without limit, and the tab fetches the postings for
 * every id it loads in one `.in()` query: 36-character uuids make that list a URL, so it cannot grow unbounded. 100 keeps it
 * near 4 KB, comfortably inside a gateway's limit, and is already more than one screenful of cards. The newest saves win;
 * the rest are in the tracker, and the tab says so (savedCapNotice).
 */
export const SAVED_TAB_MAX = 100;

/**
 * The user's saved rows, newest first, at most `max`, plus the true total from the same query (`count: "exact"`, no second
 * round trip). `capped` is whether some saved rows were left out.
 */
export async function loadSavedRows(
  supabase: SupabaseClient<Database>,
  userId: string,
  max: number = SAVED_TAB_MAX,
): Promise<{ rows: SavedApplicationRow[]; total: number; capped: boolean }> {
  const { data, count, error } = await supabase
    .from("applications")
    .select("id, job_posting_id, manual_job_snapshot", { count: "exact" })
    .eq("user_id", userId)
    .eq("stage", "saved")
    .order("created_at", { ascending: false })
    .limit(max);
  if (error) throw new Error(`Couldn't load your saved jobs: ${error.message}`);
  const rows = data ?? [];
  const total = count ?? rows.length;
  return { rows, total, capped: total > rows.length };
}

/** The line under a capped Saved tab: how many are shown, how many are not, and where the rest are. Null when nothing is left out. */
export function savedCapNotice(input: { total: number; loaded: number }): string | null {
  const hidden = input.total - input.loaded;
  if (hidden <= 0) return null;
  return `Showing your ${input.loaded} most recently saved jobs. The other ${hidden} saved ${hidden === 1 ? "job is" : "jobs are"} in your tracker.`;
}

/** An id no posting has. An empty `.in()` list is dropped by PostgREST (it would match everything), so "nothing saved" asks for this. */
const NOTHING = "00000000-0000-0000-0000-000000000000";

/**
 * The postings behind the saved ids, WITHOUT the discovery feed's rules.
 *
 * No `status = open`, no ambient 30-day floor, no unlisted exclusion: the saved ids are the user's own set, RLS already
 * keeps removed and draft postings out of reach, and a closed posting is shown as closed rather than hidden. What the
 * user chose on the page still applies: work type, seniority, and a "posted within" window if they picked one.
 *
 * Not generic over the column list: supabase-js infers the row type from the LITERAL type of the string it is given,
 * and threading a generic `C extends string` through its select<>() made `tsc` exhaust its heap. The feed page, which
 * owns FEED_COLUMNS as one literal, casts the result to the row type its other queries already use.
 */
export function buildSavedPostingsQuery(
  supabase: SupabaseClient<Database>,
  savedIds: readonly string[],
  columns: string,
  filters: { workTypes: readonly WorkType[]; seniorities: readonly Seniority[]; postedSince?: string },
) {
  let query = supabase.from("job_postings").select(columns).in("id", savedIds.length ? [...savedIds] : [NOTHING]);
  if (filters.postedSince) query = query.gte("posted_at", filters.postedSince);
  if (filters.workTypes.length) query = query.in("work_type", [...filters.workTypes]);
  if (filters.seniorities.length) query = query.in("seniority", [...filters.seniorities]);
  return query;
}
