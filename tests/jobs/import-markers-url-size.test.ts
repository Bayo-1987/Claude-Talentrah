/**
 * withImportMarkers must not send every result id in ONE request URL (production 400 "Bad Request", 14/17/21 Nov).
 *
 * The search RPC has no limit of its own beyond PostgREST's max_rows (1,000); 1,000 ids make a 39,107-character query string, which the gateway refuses with a plain-text 400
 * that postgrest-js turns into error.message "Bad Request". The largest read of this shape that succeeded in the same logs was 16,671 characters.
 *
 * The real supabase-js client builds the URL; only the network is fake. The fake gateway answers 400 "Bad Request" above the largest size known to succeed, and counts how many
 * requests are in flight at once.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
import { withImportMarkers, MAX_IN_FLIGHT } from "@/lib/jobs/import-markers";
import { IN_LIST_BATCH_SIZE } from "@/lib/supabase/in-list";

const KNOWN_GOOD_QUERY_STRING = 16_671;

function uuid(n: number) {
  return `${n.toString(16).padStart(8, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}
const addressOf = (id: string) => `jobs+${id.slice(0, 8)}@example.test`;

function gateway(opts: { failRequest?: (n: number) => boolean } = {}) {
  const seen: { len: number; ids: string[] }[] = [];
  const flight = { now: 0, max: 0 };
  const fetchImpl = async (input: RequestInfo | URL) => {
    flight.now += 1;
    flight.max = Math.max(flight.max, flight.now);
    try {
      return await handle(input);
    } finally {
      flight.now -= 1;
    }
  };
  const handle = async (input: RequestInfo | URL) => {
    await new Promise((r) => setTimeout(r, 5));
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const ids = (url.searchParams.get("id") ?? "").replace(/^in\.\(/, "").replace(/\)$/, "").split(",").filter(Boolean);
    seen.push({ len: url.search.length, ids });
    if (url.search.length > KNOWN_GOOD_QUERY_STRING || opts.failRequest?.(seen.length)) {
      return new Response("Bad Request", { status: 400, statusText: "Bad Request", headers: { "content-type": "text/plain" } });
    }
    const rows = ids.map((id) => ({ id, import_feed_id: null, expires_at_source: null, apply_email: addressOf(id), apply_link_kind: null, apply_link_host: null }));
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = createClient("http://gateway.test", "anon-key", { global: { fetch: fetchImpl as typeof fetch }, auth: { persistSession: false } });
  return { client, seen, flight };
}

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: uuid(i + 1), title: `Job ${i + 1}` }));

afterEach(() => vi.restoreAllMocks());

describe("a result set the size of a broad search", () => {
  it("MEASURE: the old single request for 1,000 ids is 39,107 characters (what production logged); a 200-id chunk is 7,907", async () => {
    const { client, seen } = gateway();
    const SELECT = "id, import_feed_id, expires_at_source, apply_email, apply_link_kind, apply_link_host";
    await client.from("job_postings").select(SELECT).in("id", rowsOf(1000).map((r) => r.id));
    await client.from("job_postings").select(SELECT).in("id", rowsOf(200).map((r) => r.id));
    expect(seen.map((x) => x.len)).toEqual([39_107, 7_907]);
    expect(seen[0].len).toBeGreaterThan(KNOWN_GOOD_QUERY_STRING);
  });

  it("every row of a 1,000-row search still gets its apply fields, and nothing is logged", async () => {
    const { client } = gateway();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await withImportMarkers(client, rowsOf(1000));
    expect(log).not.toHaveBeenCalled();
    expect(out.filter((r) => r.apply_email === addressOf(r.id))).toHaveLength(1000);
  });

  it("no single request's query string is longer than the largest one known to succeed", async () => {
    const { client, seen } = gateway();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await withImportMarkers(client, rowsOf(1000));
    expect(Math.max(...seen.map((s) => s.len))).toBeLessThanOrEqual(KNOWN_GOOD_QUERY_STRING);
  });

  it("the ids over all requests are exactly the rows' ids, each once", async () => {
    const { client, seen } = gateway();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await withImportMarkers(client, rowsOf(1000));
    const sent = seen.flatMap((s) => s.ids).sort();
    expect(sent).toEqual(rowsOf(1000).map((r) => r.id).sort());
  });
});

describe("fail-soft and the small case", () => {
  it("a result set that fits is ONE request", async () => {
    const { client, seen } = gateway();
    const out = await withImportMarkers(client, rowsOf(20));
    expect(seen).toHaveLength(1);
    expect(out.every((r) => r.apply_email === addressOf(r.id))).toBe(true);
  });

  it("fail-soft: a read the gateway refuses leaves rows unmarked, logs once, never throws", async () => {
    const { client } = gateway({ failRequest: () => true });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await withImportMarkers(client, rowsOf(5));
    expect(out).toHaveLength(5);
    expect(out.every((r) => r.apply_email === null && r.import_feed_id === null)).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("Bad Request");
  });

  it("fail-soft per request: when ONE request of several fails, only its rows are unmarked, the rest are filled, and it logs once", async () => {
    const { client, seen } = gateway({ failRequest: (n) => n === 2 });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await withImportMarkers(client, rowsOf(1000));
    expect(seen.length).toBeGreaterThan(2);
    const failedIds = new Set(seen[1].ids);
    expect(log).toHaveBeenCalledTimes(1);
    for (const r of out) expect(r.apply_email).toBe(failedIds.has(r.id) ? null : addressOf(r.id));
  });
});

describe("chunk boundaries and concurrency", () => {
  it("uses the repo's batch size", () => {
    expect(IN_LIST_BATCH_SIZE).toBe(200);
    expect(MAX_IN_FLIGHT).toBe(5);
  });

  it("200 rows make ONE query, 201 make TWO, 1,000 make FIVE", async () => {
    for (const [n, requests] of [[1, 1], [200, 1], [201, 2], [400, 2], [401, 3], [1000, 5]] as const) {
      const { client, seen } = gateway();
      vi.spyOn(console, "error").mockImplementation(() => {});
      await withImportMarkers(client, rowsOf(n));
      expect([n, seen.length]).toEqual([n, requests]);
    }
  });

  it("no request's query string is longer than 8,000 characters (half the smallest failure the repo has measured)", async () => {
    const { client, seen } = gateway();
    await withImportMarkers(client, rowsOf(1000));
    expect(Math.max(...seen.map((s) => s.len))).toBeLessThanOrEqual(8_000);
  });

  it("the last partial chunk is read: every id of 1,001 rows is sent once and every row is filled", async () => {
    const { client, seen } = gateway();
    const out = await withImportMarkers(client, rowsOf(1001));
    expect(seen.flatMap((s) => s.ids).sort()).toEqual(rowsOf(1001).map((r) => r.id).sort());
    expect(out.every((r) => r.apply_email === addressOf(r.id))).toBe(true);
  });

  it("keeps the rows' order and their own fields", async () => {
    const { client } = gateway();
    const rows = rowsOf(450);
    const out = await withImportMarkers(client, rows);
    expect(out.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(out.every((r, i) => r.title === `Job ${i + 1}`)).toBe(true);
  });

  it("runs chunks together, never more than 5 in flight: 1,600 rows (8 chunks) peak at exactly 5", async () => {
    const { client, seen, flight } = gateway();
    await withImportMarkers(client, rowsOf(1600));
    expect(seen).toHaveLength(8);
    expect(flight.max).toBe(5);
  });

  it("a REJECTED call (the client throws, not a 400 answer) blanks only its own chunk and is logged once with the count", async () => {
    const rows = rowsOf(1000);
    const lost = new Set(rows.slice(400, 600).map((r) => r.id)); // the third chunk
    const stub = {
      from: () => ({
        select: () => ({
          in: async (_col: string, ids: string[]) => {
            if (ids.some((id) => lost.has(id))) throw new TypeError("fetch failed");
            return { data: ids.map((id) => ({ id, import_feed_id: null, expires_at_source: null, apply_email: addressOf(id), apply_link_kind: null, apply_link_host: null })), error: null };
          },
        }),
      }),
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await withImportMarkers(stub, rows);
    for (const r of out) expect(r.apply_email).toBe(lost.has(r.id) ? null : addressOf(r.id));
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/could not read import markers for search results: fetch failed \(1 of 5 requests failed\)/);
  });

  it("two failed chunks: one log line, both counted", async () => {
    const { client } = gateway({ failRequest: (n) => n === 1 || n === 5 });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await withImportMarkers(client, rowsOf(1000));
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("(2 of 5 requests failed)");
  });

  it("a single failed request logs the same words as before (no count suffix)", async () => {
    const { client } = gateway({ failRequest: () => true });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await withImportMarkers(client, rowsOf(3));
    expect(log.mock.calls[0][0]).toBe("[jobs] could not read import markers for search results: Bad Request");
  });

  it("the reader uses the repo's chunker, not a private loop, and defines no batch size of its own", () => {
    const src = readFileSync("src/lib/jobs/import-markers.ts", "utf8");
    expect(src).toMatch(/from "@\/lib\/supabase\/in-list"/);
    expect(src).toContain("chunkInList(");
    expect(src.match(/\b[A-Z_]*BATCH_SIZE\s*=\s*\d+/g) ?? []).toEqual([]);
  });
});

