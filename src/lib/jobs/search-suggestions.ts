import type { Tables } from "@/lib/supabase/types";
import { skillsOf } from "./skill-facet";

// See skill-facet.ts's identical alias for why this is Omit, not the full row.
type JobPosting = Omit<Tables<"job_postings">, "description_preview">;

/**
 * Typeahead suggestions for the feed's search field.
 *
 * ── WHY THE WHOLE INDEX SHIPS TO THE BROWSER ──────────────────────────────
 *
 * The feed already fetches every open posting — there is no pagination — so
 * the values a suggestion could offer are all in hand on the server. Measured
 * against the 155 open postings in production: 123 distinct titles, 13
 * companies, ~50 atomic locations, about 5KB of distinct strings before
 * compression. That is smaller than one job card's markup.
 *
 * Shipping it means filtering happens locally, which means there is no network
 * round trip per keystroke, which means THERE IS NO DEBOUNCE. Debounce exists
 * to protect a request; with no request there is nothing to protect and a
 * delay is just latency someone chose to add. This matters more than usual for
 * this project's market — low-end Android on expensive data — where the
 * alternative is a request per keystroke.
 *
 * Same caveat as searchJobs and the skill facet: this stops being true if the
 * board grows enough to need paging. At that point the index moves behind a
 * route and a debounce becomes correct. INDEX_CAP_PER_KIND bounds the payload
 * until then rather than letting it grow silently.
 *
 * ── COUNTS ARE RESULT COUNTS, NOT FREQUENCIES ─────────────────────────────
 *
 * The obvious implementation counts how often a value appears. That number is
 * wrong the moment it is clicked, and the live data makes it wrong by a lot.
 *
 * `location` holds semicolon-joined lists — "Jigawa, Nigeria; Kaduna,
 * Nigeria; Kano, Nigeria; …" is one real row. Splitting those into atomic
 * values is necessary (nobody wants a ninety-character suggestion that
 * matches one posting), but then "Lagos, Nigeria" occurs as its own value 21
 * times while `searchJobs` — a substring match over title + company +
 * location — actually returns 28, because "Remote, Lagos, Nigeria" and
 * "Lagos, Nigeria; Remote, Nigeria" contain it too.
 *
 * So each count is computed by running the same match `searchJobs` will run.
 * The number beside a suggestion is a promise about what clicking it does, and
 * this is the only way to keep it.
 */

export type SuggestionKind = "title" | "company" | "location";

export interface Suggestion {
  kind: SuggestionKind;
  value: string;
  /** How many postings `searchJobs` returns for this value. Not a frequency. */
  count: number;
}

/**
 * A ceiling on the shipped payload, not a product decision. Today's board
 * produces 123 titles, so nothing is dropped; this exists so a board that
 * grows tenfold does not silently grow the page with it.
 */
const INDEX_CAP_PER_KIND = 200;

/** Must stay identical to searchJobs' haystack, or the counts stop being true. */
function haystack(job: JobPosting): string {
  return [job.title, job.company_name, job.location, ...skillsOf(job)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Locations arrive as "A; B; C" for roles open in several places. Split, since
 * the joined string is not a thing anyone would search for — and substring
 * matching means each part still finds the combined row.
 */
function locationParts(location: string | null): string[] {
  if (!location) return [];
  return location
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function buildSuggestionIndex(jobs: JobPosting[]): Suggestion[] {
  const haystacks = jobs.map(haystack);

  const candidates: Record<SuggestionKind, Set<string>> = {
    title: new Set(),
    company: new Set(),
    location: new Set(),
  };

  for (const job of jobs) {
    if (job.title?.trim()) candidates.title.add(job.title.trim());
    if (job.company_name?.trim()) candidates.company.add(job.company_name.trim());
    for (const part of locationParts(job.location)) candidates.location.add(part);
  }

  const out: Suggestion[] = [];
  for (const kind of ["title", "company", "location"] as const) {
    const scored: Suggestion[] = [];
    for (const value of candidates[kind]) {
      const needle = value.toLowerCase();
      let count = 0;
      for (const h of haystacks) if (h.includes(needle)) count++;
      // Zero is unreachable — the value came from one of these rows — but a
      // zero-count suggestion would be a dead end, so it never ships.
      if (count > 0) scored.push({ kind, value, count });
    }
    scored.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    out.push(...scored.slice(0, INDEX_CAP_PER_KIND));
  }
  return out;
}

/** How many rows the untyped list shows, and of what. */
const DEFAULT_LOCATIONS = 4;
const DEFAULT_TITLES = 2;

/**
 * The list shown on focus, before anything is typed.
 *
 * Locations and a couple of titles, computed live from the current board —
 * NOT recent searches. Nothing about the visitor is stored anywhere, no
 * localStorage: job hunting is confidential (the build prompt's
 * private-by-default stance) and this market skews toward shared and borrowed
 * devices, where a persisted "recent searches" list quietly tells the next
 * person you are looking. A live board summary is as useful and leaks nothing.
 *
 * NO COMPANIES HERE, deliberately. One employer is 131 of the 155 open
 * postings, so a top-companies list is that employer plus noise, and it would
 * read as an advert rather than as navigation.
 *
 * Honest limitation: with the board as it stands the top titles are narrow and
 * employer-specific ("Data Analyst - Fraud"), because most titles occur once.
 * That is a description of the current supply rather than a fault in the
 * ranking, and it improves on its own as the board diversifies.
 */
export function defaultSuggestions(index: Suggestion[]): Suggestion[] {
  const byKind = (kind: SuggestionKind, n: number) =>
    index.filter((s) => s.kind === kind).slice(0, n);
  return [...byKind("location", DEFAULT_LOCATIONS), ...byKind("title", DEFAULT_TITLES)];
}

const MAX_PER_GROUP = 5;
const MAX_TOTAL = 10;

/**
 * Matches for what has been typed, ranked prefix-first.
 *
 * A prefix match is what someone typing expects to see; a substring match is a
 * bonus. "eng" should lead with "Engineering Manager" rather than with
 * "Principal Generalist Engineer", even where the latter matches more
 * postings.
 *
 * The total cap is filled round-robin across the three groups rather than by
 * truncating the tail, so a query matching six titles cannot push locations
 * off the list entirely — with 5-per-group and 10 total, straight truncation
 * would leave the third group with nothing to show.
 */
export function filterSuggestions(index: Suggestion[], query: string): Suggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const groups: Record<SuggestionKind, Suggestion[]> = { title: [], company: [], location: [] };

  for (const s of index) {
    const value = s.value.toLowerCase();
    const prefix = value.startsWith(q);
    if (!prefix && !value.includes(q)) continue;
    groups[s.kind].push(s);
  }

  for (const kind of ["title", "company", "location"] as const) {
    groups[kind].sort((a, b) => {
      const aPrefix = a.value.toLowerCase().startsWith(q) ? 0 : 1;
      const bPrefix = b.value.toLowerCase().startsWith(q) ? 0 : 1;
      return aPrefix - bPrefix || b.count - a.count || a.value.localeCompare(b.value);
    });
    groups[kind] = groups[kind].slice(0, MAX_PER_GROUP);
  }

  const picked: Suggestion[] = [];
  for (let rank = 0; rank < MAX_PER_GROUP && picked.length < MAX_TOTAL; rank++) {
    for (const kind of ["title", "company", "location"] as const) {
      if (picked.length >= MAX_TOTAL) break;
      const s = groups[kind][rank];
      if (s) picked.push(s);
    }
  }
  return picked;
}

/** Display order for the rendered groups; fixed, so the list never reshuffles. */
export const GROUP_ORDER: readonly SuggestionKind[] = ["title", "company", "location"] as const;

export const GROUP_LABEL: Record<SuggestionKind, string> = {
  title: "Titles",
  company: "Companies",
  location: "Locations",
};
