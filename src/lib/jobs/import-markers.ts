import "server-only";

/**
 * `search_job_postings` returns an explicit column list that does not include import_feed_id (0100/0108/0127), so a search result row cannot tell the card that a posting is IMPORTED, and an
 * imported posting would fall back to the in-app Apply. This adds the marker to those rows with one small read of the public column (import_feed_id is readable by anon and authenticated, 0246),
 * keyed by id. A failed read leaves the rows unmarked and is logged: it cannot make the page fail, but it is not silent. A test (tests/jobs/search-import-markers.test.ts) holds the merge.
 */
type Client = { from: (table: string) => { select: (cols: string) => { in: (col: string, ids: string[]) => PromiseLike<{ data: Array<{ id: string; import_feed_id: string | null }> | null; error: { message: string } | null }> } } };

export async function withImportMarkers<T extends { id: string }>(supabase: unknown, rows: readonly T[]): Promise<Array<T & { import_feed_id: string | null }>> {
  if (rows.length === 0) return [];
  const { data, error } = await (supabase as Client).from("job_postings").select("id, import_feed_id").in("id", rows.map((r) => r.id));
  if (error) console.error(`[jobs] could not read import markers for search results: ${error.message}`);
  const marker = new Map((data ?? []).map((r) => [r.id, r.import_feed_id]));
  return rows.map((r) => ({ ...r, import_feed_id: marker.get(r.id) ?? null }));
}
