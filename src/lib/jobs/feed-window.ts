import type { Tables } from "@/lib/supabase/types";
import type { StructuredResume } from "@/lib/resume/types";
import { scoreJobs, type ScoredJob, type ScoringJob } from "@/lib/matching/compute-and-store";
import { sortFeedResults } from "./ranking";

/**
 * The Recommended and External tabs, split in two reads (FEED-PERF-1).
 *
 * Ranking needs the WHOLE filtered window: a posting's place depends on every other posting's score, and the country menu's counts, the search suggestions and the
 * match-score cache (which Auto-Apply and the paid slots read) are all defined over that window. Cards need only the page the reader is looking at. These two facts used
 * to be served by one read of every column of every open posting from the last 30 days. Now:
 *
 *   Read A  the whole window, NARROW: RANK_COLUMNS, just what scoring, ranking, the country counts and the suggestion index read, with the skills taken out of
 *           structured_jd by the database (`structured_jd->skills`) instead of shipping the column. Scoring, ranking, counts, suggestions and persisting the scores all
 *           run over these rows, so none of them can change because of paging.
 *   Read B  full card rows (the page's own FEED_COLUMNS) for the ids of the requested page only, put back in ranked order by attachFullRows.
 *
 * ORDER, AND WHY A PAGE NEVER REPEATS A PROMOTED CARD. The promoted reorder is applied to the whole ranked list, then the list is sliced. A promoted posting therefore
 * sits in slots 0 and 1 of page 1 and is absent from its organic place on every later page; slicing first and reordering the page would show it twice.
 *
 * THE CAP COMES AFTER SCORING. RECOMMENDED_HARD_CAP trims the tail of the already ranked list. Applied to the input it would drop whichever rows the database happened
 * to return last, however well they match.
 *
 * Pure: no database, no clock of its own (the ranking reads Date.now for the freshness decay, as it always did). The page does the reads.
 */

/** Interim ceiling on a ranked window (docs/jobs-feed-pagination.md): a no-op while the board is smaller, applied after scoring and ranking. */
export const RECOMMENDED_HARD_CAP = 2000;

/** Cards per page, the same 24 Most Recent shows. */
export const FEED_PAGE_SIZE = 24;

/**
 * Read A's select list. One string literal, because supabase-js reads a result's type from the literal text of `select(...)`. `jd_skills` is the skills array only; toRankRow
 * puts it back in the `structured_jd` shape the scorer and the suggestion index read.
 */
export const RANK_COLUMNS = "id, posted_at, title, company_name, location, external_source, work_type, seniority, jd_skills:structured_jd->skills";

export type RankRow = Pick<
  Tables<"job_postings">,
  "id" | "posted_at" | "title" | "company_name" | "location" | "external_source" | "work_type" | "seniority" | "structured_jd"
>;

/** A Read A row as the database sends it. */
export type RankRowRaw = Omit<RankRow, "structured_jd"> & { jd_skills: unknown };

export function toRankRow(raw: RankRowRaw): RankRow {
  const { jd_skills, ...rest } = raw;
  const skills = Array.isArray(jd_skills) ? jd_skills.filter((s): s is string => typeof s === "string") : null;
  return { ...rest, structured_jd: skills ? { skills } : null };
}

export interface RankOptions {
  tab: string;
  hasSearchTerm: boolean;
  freshnessWindowDays: number;
  /** Promoted posting ids, in the order they take the first slots. */
  promotedIds: string[];
  /** Overrides RECOMMENDED_HARD_CAP (tests). */
  hardCap?: number;
}

export interface RankedWindow<J extends ScoringJob> {
  /** Every row of the window, scored, in final order. This is what gets persisted: never a page of it. */
  ranked: ScoredJob<J>[];
  /** The promoted ids that are actually in the window, in slot order. Only these may be shown or billed. */
  promotedPresent: string[];
}

export function rankFeedWindow<J extends ScoringJob>(resume: StructuredResume, rows: J[], o: RankOptions): RankedWindow<J> {
  const ranked = scoreJobs(resume, rows);
  sortFeedResults(ranked, o.tab, o.hasSearchTerm, o.freshnessWindowDays);

  const inWindow = new Set(ranked.map((s) => s.job.id));
  const promotedPresent = o.promotedIds.filter((id) => inWindow.has(id));
  if (promotedPresent.length > 0) {
    const slot = new Map(promotedPresent.map((id, i) => [id, i]));
    ranked.sort((a, b) => {
      const sa = slot.get(a.job.id);
      const sb = slot.get(b.job.id);
      if (sa !== undefined && sb !== undefined) return sa - sb;
      if (sa !== undefined) return -1;
      if (sb !== undefined) return 1;
      return 0; // everything else keeps the order it already had
    });
  }

  ranked.length = Math.min(ranked.length, o.hardCap ?? RECOMMENDED_HARD_CAP);
  return { ranked, promotedPresent };
}

export interface FeedPage<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}

/** One page of the ranked list. A page past the end is the last page and anything unreadable is page 1, so a stale link never shows an empty feed. */
export function selectPage<T>(ranked: T[], requested: number, size: number = FEED_PAGE_SIZE): FeedPage<T> {
  const totalPages = Math.max(1, Math.ceil(ranked.length / size));
  const wanted = Number.isFinite(requested) ? Math.floor(requested) : 1;
  const page = Math.min(Math.max(1, wanted), totalPages);
  return { items: ranked.slice((page - 1) * size, page * size), page, totalPages, total: ranked.length };
}

/** The ids Read B asks for: the page's, then any promoted card shown that is not already among them. */
export function pageReadIds(pageIds: string[], promotedShown: string[]): string[] {
  return [...new Set([...pageIds, ...promotedShown])];
}

/**
 * Read B's rows put back in the page's ranked order, each carrying the score and explanation computed in Read A's pass. The database returns an `in (...)` read in no
 * particular order; a row that closed between the two reads is simply absent and the others keep their places.
 */
export function attachFullRows<J extends ScoringJob, F extends ScoringJob>(pageRanked: ScoredJob<J>[], fullRows: F[]): ScoredJob<F>[] {
  const byId = new Map(fullRows.map((r) => [r.id, r]));
  const out: ScoredJob<F>[] = [];
  for (const s of pageRanked) {
    const job = byId.get(s.job.id);
    if (job) out.push({ ...s, job });
  }
  return out;
}
