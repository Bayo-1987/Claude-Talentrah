/**
 * How many values one `.in(column, list)` filter may carry.
 *
 * WHY THERE IS A NUMBER AT ALL. supabase-js turns `.in("id", ids)` into `?id=in.(a,b,c…)` — every value is
 * part of the REQUEST URL, not the body — and the gateway in front of PostgREST refuses a URL past a fixed
 * length ("URI too long"). A list that is fine at 50 ids silently stops working as a table grows, and the
 * failure looks like an unrelated query error.
 *
 * WHY 200. It is not a new number: `ingest.ts` (closing stale postings) and `posting-deletion.ts` (the 30-day
 * delete) each already batched at 200 for exactly this reason, and this module is those two constants made one.
 * The margin against the evidence, measured 2026-09-30 with the real supabase-js builder for UUID lists:
 *
 *      200 ids  ->   7,881-character URL      <- this constant
 *      372 ids  ->  14,589                    <- smallest failure observed (CI's local Supabase stack)
 *      395 ids  ->  15,486                    <- last size the hosted gateway accepted
 *      398 ids  ->  15,603                    <- first size the hosted gateway dropped
 *
 * So 200 sits at roughly half of the smallest known failure. The exact limit of CI's stack is not measured
 * (only that 372 is over it), so the margin is deliberately generous rather than tuned. Pinned by
 * `tests/lib/in-list.test.ts`, which measures the real URL and fails if a future value eats the margin.
 *
 * CALIBRATED FOR UUIDS (36 characters; ~39 in the URL once encoded). The limit is on URL LENGTH, not on item count,
 * so a list of longer values needs a smaller batch: a sha256 hex string (64 characters; ~67 encoded) reaches the
 * smallest observed failure at roughly 217 items, so a full 200-item chunk of them would sit on the edge. Callers
 * with values like that must pass their own `size` to `chunkInList` (about 100 is comfortable). Lists interpolated
 * into an `.or("col.in.(...)")` string are the same URL and are not helped by this module at all.
 *
 * ROW COUNTS ARE A SEPARATE LIMIT. PostgREST also caps rows returned per request (`max_rows`, 1000 by default);
 * a chunk of 200 ids can return at most 200 rows, so chunking does not run into it. A query that filters by
 * `.eq()` and can match many rows is not helped by this module.
 */
export const IN_LIST_BATCH_SIZE = 200;

/**
 * Split a list into consecutive chunks of at most `size`, preserving order. An empty list gives no chunks.
 * Callers run one query per chunk and merge — for a list that fits in one chunk this is exactly one query,
 * the same one the un-chunked code made.
 */
export function chunkInList<T>(items: readonly T[], size: number = IN_LIST_BATCH_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`chunkInList: size must be a positive integer, got ${size}`);
  }
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
