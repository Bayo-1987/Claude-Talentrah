import "server-only";

/**
 * `search_job_postings` returns an explicit column list that does not include import_feed_id (0100/0108/0127), so a search result row cannot tell the card that a posting is IMPORTED, and an
 * imported posting would fall back to the in-app Apply. This adds the marker to those rows with one small read of the public column (import_feed_id is readable by anon and authenticated, 0246),
 * keyed by id. A failed read leaves the rows unmarked and is logged: it cannot make the page fail, but it is not silent. A test (tests/jobs/search-import-markers.test.ts) holds the merge.
 *
 * THE SAME READ ALSO CARRIES expires_at_source (0278, public like the rest of the row), because the RPC returns expires_at but not whether anyone STATED it, and a card shows "Closes <date>" only for a
 * stated date (src/lib/jobs/closing-date.ts). Without it a search result never shows a closing date; a promoted job that appears in a search is one of these rows. A row the read does not return, or a
 * failed read, gets null, which shows nothing: the date is only ever shown on evidence.
 *
 * AND THE THREE APPLY COLUMNS: apply_email, apply_link_kind, apply_link_host (0274/0277, readable by anon and authenticated, the same as the unsearched feed's FEED_COLUMNS). The RPC returns none of them, and the card
 * decides "Apply by email" and an employer's career-site button from exactly these, so on the search path an external posting that takes applications by email showed only "Mark as applied". The address stays
 * out of every rendered text: the card puts it only in a mailto href (tests/jobs/apply-email-leaks.test.ts keeps the list of files that may name the column; this one is on it). The withheld full link (the column tests/jobs/apply-link-leaks.test.ts guards) is deliberately NOT read: the
 * card needs only the kind and the host. A row the read does not return, or a failed read, gets null for all three, which is what the card already treats as "no address, no career-site link".
 *
 * ONE REQUEST IS NOT ENOUGH FOR A BROAD SEARCH. `.in("id", ids)` puts every id in the request URL, and the search RPC has no limit of its own beyond PostgREST's max_rows (1,000), so a broad term
 * made a 39,107-character query string that the gateway refused with a plain-text 400 "Bad Request" (production, 14, 17 and 21 Nov; 1,000 ids is exactly 39,107 characters). The ids are therefore read in
 * chunks of IN_LIST_BATCH_SIZE (src/lib/supabase/in-list.ts, the repo's constant for this failure), at most MAX_IN_FLIGHT requests at once. A result of that size or smaller is still ONE query. A chunk that fails
 * (an error answer, or a rejected call) leaves only ITS rows unmarked; the others are filled. One log line per call, not per chunk. The search is not paged, so the page draws a card for every row read.
 */
import { chunkInList } from "@/lib/supabase/in-list";

/** At most this many chunk requests are in flight at once. */
export const MAX_IN_FLIGHT = 5;

type Fact = { id: string; import_feed_id: string | null; expires_at_source?: string | null; apply_email?: string | null; apply_link_kind?: string | null; apply_link_host?: string | null };
type Client = { from: (table: string) => { select: (cols: string) => { in: (col: string, ids: string[]) => PromiseLike<{ data: Fact[] | null; error: { message: string } | null }> } } };

type Marked = { import_feed_id: string | null; expires_at_source: string | null; apply_email: string | null; apply_link_kind: string | null; apply_link_host: string | null };

export async function withImportMarkers<T extends { id: string }>(supabase: unknown, rows: readonly T[]): Promise<Array<T & Marked>> {
  if (rows.length === 0) return [];
  const client = supabase as Client;
  const chunks = chunkInList(rows.map((r) => r.id));
  const facts = new Map<string, Fact>();
  let failed = 0;
  let firstMessage = "";
  const readChunk = async (ids: string[]) => {
    try {
      const { data, error } = await client.from("job_postings").select("id, import_feed_id, expires_at_source, apply_email, apply_link_kind, apply_link_host").in("id", ids);
      if (error) return { data: null, message: error.message };
      return { data: data ?? [], message: null };
    } catch (e) {
      return { data: null, message: e instanceof Error ? e.message : String(e) };
    }
  };
  for (let i = 0; i < chunks.length; i += MAX_IN_FLIGHT) {
    const results = await Promise.all(chunks.slice(i, i + MAX_IN_FLIGHT).map(readChunk));
    for (const r of results) {
      if (r.message !== null) {
        failed += 1;
        if (!firstMessage) firstMessage = r.message;
      } else {
        for (const f of r.data ?? []) facts.set(f.id, f);
      }
    }
  }
  if (failed > 0) {
    const detail = chunks.length > 1 ? ` (${failed} of ${chunks.length} requests failed)` : "";
    console.error(`[jobs] could not read import markers for search results: ${firstMessage}${detail}`);
  }
  return rows.map((r) => {
    const f = facts.get(r.id);
    return {
      ...r,
      import_feed_id: f?.import_feed_id ?? null,
      expires_at_source: f?.expires_at_source ?? null,
      apply_email: f?.apply_email ?? null,
      apply_link_kind: f?.apply_link_kind ?? null,
      apply_link_host: f?.apply_link_host ?? null,
    };
  });
}
