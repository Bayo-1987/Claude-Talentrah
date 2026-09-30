/**
 * The shared `.in()` batch size and chunker (src/lib/supabase/in-list.ts).
 *
 * Three things need pinning, because each fails silently:
 *
 *  1. The chunker's contract — order, exact boundaries, no chunk over the size. A chunker that drops or
 *     duplicates one id at a boundary would corrupt a delete or a stale-check without any error.
 *  2. The VALUE, and its margin against the evidence. `IN_LIST_BATCH_SIZE` carries real identity (the URL-length
 *     ceiling of the gateway); a test of the chunker's logic alone would pass at 2,000, which would break every
 *     caller in production and pass everything. So the real URL supabase-js builds is measured here and compared
 *     with the smallest length KNOWN to fail (372 ids on CI's local stack, 2026-09-30).
 *  3. That the three callers actually USE the shared constant. Before this module `ingest.ts` and
 *     `posting-deletion.ts` each had a private `= 200`, and the refresh job had no batching at all; a fourth
 *     private copy is how they would drift apart again.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { IN_LIST_BATCH_SIZE, chunkInList } from "@/lib/supabase/in-list";

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const uuids = (n: number) => Array.from({ length: n }, (_, i) => uuid(i));

/** The real length of the URL supabase-js builds for `.in("id", <n uuids>)` — measured, not modelled. */
async function inUrlLength(n: number): Promise<number> {
  let length = 0;
  const probe = createClient("https://example.supabase.co", "fake-key", {
    global: {
      fetch: (async (u: RequestInfo | URL) => {
        length = String(u).length;
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    },
  });
  await probe.from("job_postings").select("id").in("id", uuids(n));
  return length;
}

describe("chunkInList", () => {
  it("returns no chunks for an empty list", () => {
    expect(chunkInList([])).toEqual([]);
  });

  it("returns one chunk, unchanged, for a list that fits", () => {
    expect(chunkInList(["a", "b", "c"])).toEqual([["a", "b", "c"]]);
    expect(chunkInList(uuids(IN_LIST_BATCH_SIZE))).toHaveLength(1);
  });

  it.each([
    [IN_LIST_BATCH_SIZE, [IN_LIST_BATCH_SIZE]],
    [IN_LIST_BATCH_SIZE + 1, [IN_LIST_BATCH_SIZE, 1]],
    [IN_LIST_BATCH_SIZE * 2, [IN_LIST_BATCH_SIZE, IN_LIST_BATCH_SIZE]],
    [IN_LIST_BATCH_SIZE * 2 + 1, [IN_LIST_BATCH_SIZE, IN_LIST_BATCH_SIZE, 1]],
    [388, [IN_LIST_BATCH_SIZE, 388 - IN_LIST_BATCH_SIZE]],
  ])("splits %i items into chunks of sizes %j", (n, sizes) => {
    expect(chunkInList(uuids(n)).map((c) => c.length)).toEqual(sizes);
  });

  it("preserves order and loses or duplicates nothing at any boundary", () => {
    for (const n of [1, 2, 199, 200, 201, 399, 400, 401, 1484]) {
      const items = uuids(n);
      expect(chunkInList(items).flat(), `n=${n}`).toEqual(items);
    }
  });

  it("never emits a chunk over the requested size, for any size", () => {
    const items = uuids(97);
    for (const size of [1, 2, 3, 7, 50, 96, 97, 98, 500]) {
      for (const chunk of chunkInList(items, size)) expect(chunk.length).toBeLessThanOrEqual(size);
    }
  });

  it("honours a custom size", () => {
    expect(chunkInList([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it.each([0, -1, 1.5, Number.NaN, Infinity])("rejects the invalid size %s instead of looping forever", (size) => {
    expect(() => chunkInList([1, 2, 3], size)).toThrow(RangeError);
  });

  it("does not mutate its input", () => {
    const items = uuids(450);
    const copy = [...items];
    chunkInList(items);
    expect(items).toEqual(copy);
  });
});

describe("IN_LIST_BATCH_SIZE — the value, and its margin against the evidence", () => {
  it("is 200 — the value ingest.ts and posting-deletion.ts already used", () => {
    expect(
      IN_LIST_BATCH_SIZE,
      "changing this changes closing stale postings, the 30-day posting deletion AND the refresh-job recovery lookup; " +
        "re-measure against the URL limits documented in src/lib/supabase/in-list.ts before touching it",
    ).toBe(200);
  });

  it("produces a URL at most 60% of the smallest length known to fail (372 ids on CI's local stack)", async () => {
    const chunkUrl = await inUrlLength(IN_LIST_BATCH_SIZE);
    const knownFailure = await inUrlLength(372);
    expect(
      chunkUrl,
      `a full chunk builds a ${chunkUrl}-character URL; the smallest failure observed was ${knownFailure} characters`,
    ).toBeLessThanOrEqual(knownFailure * 0.6);
  });

  it("the whole ~388-posting board, unchunked, is over the smallest known failure (why this exists)", async () => {
    expect(await inUrlLength(388)).toBeGreaterThan(await inUrlLength(372));
  });
});

describe("the callers use the shared constant, not private copies", () => {
  const callers = ["src/lib/matching/refresh-job.ts", "src/lib/jobs/ingest.ts", "src/lib/jobs/posting-deletion.ts"];

  it.each(callers)("%s imports from @/lib/supabase/in-list", (file) => {
    expect(readFileSync(file, "utf8")).toMatch(/from "@\/lib\/supabase\/in-list"/);
  });

  it.each(callers)("%s defines no batch size of its own", (file) => {
    const privateConstants = readFileSync(file, "utf8").match(/\b[A-Z_]*BATCH_SIZE\s*=\s*\d+/g) ?? [];
    expect(privateConstants, `${file} has its own batch-size constant — use IN_LIST_BATCH_SIZE`).toEqual([]);
  });
});
