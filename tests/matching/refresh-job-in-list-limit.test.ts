/**
 * The match-score refresh job's recovery path must not put the whole board in one URL.
 *
 * THE BUG (issue #577). `persistScoresOrRetryStale` upserts one user's scores in a single POST. If a
 * posting was deleted mid-run, Postgres rejects the batch with `23503`; the recovery then asks
 * `job_postings` which of the batch's ids still exist with `.in("id", ids)` — and `.in()` puts every id in the
 * REQUEST URL. With a ~370–390 posting board that URL is over the gateway's limit, the request is refused
 * ("URI too long"), the function reports `ok: false`, and the user's whole batch is silently lost (`failed++`,
 * while `summary.ok` stays true). It made `refresh-job.test.ts` fail on CI about 17% of the time (8 of 47
 * first attempts on 2026-09-29), always at the same assertion.
 *
 * WHAT THIS FILE DOES DIFFERENTLY FROM refresh-job.test.ts. That suite runs against a real database, where the
 * failure needs a concurrent delete to happen at the right instant — which is why it is intermittent and why it
 * cannot prove a fix. This file makes the trigger deterministic and needs no database: it drives the REAL
 * `persistScoresOrRetryStale` and `runMatchScoreRefreshJob` through a REAL `supabase-js` client (so the real
 * query builder builds the real URL) whose `fetch` is a fake PostgREST that
 *   - returns `23503` for an upsert that references a deleted posting, and
 *   - refuses any URL longer than the shortest one KNOWN to fail.
 *
 * THE LIMIT IS EVIDENCE, NOT A GUESS. Measured 2026-09-30: CI's local Supabase stack rejected the recovery
 * request at 372 ids (its exact limit is lower and unmeasured); the hosted gateway accepted 395 and dropped 398.
 * The fake refuses anything longer than the URL for 371 ids, i.e. exactly "372 ids fails, as observed".
 *
 * Every assertion carries a failure-only diagnostic (summary, request log, captured job output) — the message is
 * only ever shown when the assertion fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getMatchTier } from "@/lib/match-tier";
import type { ScoredJobLike } from "@/lib/matching/compute-and-store";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => holder.client }));

import { persistScoresOrRetryStale, runMatchScoreRefreshJob } from "@/lib/matching/refresh-job";

const FAKE_URL = "http://fake-postgrest.test";
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const uuids = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => uuid(i + offset));

// ── the fake PostgREST ───────────────────────────────────────────────────────────────────────────────────────

type LoggedRequest = { method: string; table: string; status: number; urlLength: number; ids?: number };

interface FakeOptions {
  /** Every posting that exists on the board. */
  postings: string[];
  /** Postings deleted before the run starts. */
  deleted?: string[];
  /** Postings deleted at the moment of the FIRST match_scores upsert (a delete landing mid-run). */
  deleteOnFirstUpsert?: string[];
  /** URLs longer than this are refused with 414 "URI too long". */
  urlLimit?: number;
  /** Make every `job_postings ... id=in.(...)` existence lookup fail with a 500, leaving all other requests alone. */
  failLookups?: boolean;
  /** Users with a base resume. */
  users?: string[];
  /** true: every user already has a score for every posting (nothing to refresh). */
  fullCoverage?: boolean;
}

function makeFake(opts: FakeOptions) {
  const deleted = new Set(opts.deleted ?? []);
  const requests: LoggedRequest[] = [];
  const written = new Map<string, number>(); // "user|posting" -> score
  let upserts = 0;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const table = url.pathname.replace("/rest/v1/", "");
    const log = (status: number, ids?: number) =>
      requests.push({ method, table, status, urlLength: url.toString().length, ids });
    const respond = (res: Response, ids?: number) => {
      log(res.status, ids);
      return res;
    };

    if (opts.urlLimit !== undefined && url.toString().length > opts.urlLimit) {
      return respond(new Response("URI too long", { status: 414 }));
    }

    if (table === "match_scores" && method === "POST") {
      upserts += 1;
      if (upserts === 1) for (const id of opts.deleteOnFirstUpsert ?? []) deleted.add(id);
      const rows = JSON.parse(String(init?.body)) as Array<{ user_id: string; job_posting_id: string; score: number }>;
      if (rows.some((r) => deleted.has(r.job_posting_id))) {
        return respond(
          json(
            {
              code: "23503",
              message:
                'insert or update on table "match_scores" violates foreign key constraint "match_scores_job_posting_id_fkey"',
            },
            409,
          ),
          rows.length,
        );
      }
      // PostgREST semantics the refresh now relies on: `Prefer: resolution=ignore-duplicates` is INSERT ... ON CONFLICT DO NOTHING (an existing
      // row is kept), and `Prefer: return=representation` (what `.select()` after an upsert sends) answers with the rows actually INSERTED.
      const prefer = new Headers(init?.headers).get("prefer") ?? "";
      const ignoreDuplicates = prefer.includes("resolution=ignore-duplicates");
      const inserted: Array<{ job_posting_id: string }> = [];
      for (const r of rows) {
        const key = `${r.user_id}|${r.job_posting_id}`;
        if (ignoreDuplicates && written.has(key)) continue;
        written.set(key, r.score);
        inserted.push({ job_posting_id: r.job_posting_id });
      }
      if (prefer.includes("return=representation")) return respond(json(inserted, 201), rows.length);
      return respond(new Response(null, { status: 201 }), rows.length);
    }

    if (table === "job_postings" && method === "GET") {
      const idFilter = url.searchParams.get("id");
      if (idFilter?.startsWith("in.(")) {
        const asked = idFilter.slice(4, -1).split(",");
        if (opts.failLookups) return respond(json({ message: "simulated lookup failure" }, 500), asked.length);
        const live = asked.filter((id) => opts.postings.includes(id) && !deleted.has(id));
        return respond(json(live.map((id) => ({ id }))), asked.length);
      }
      // the eligible-board query
      return respond(
        json(
          opts.postings
            .filter((id) => !deleted.has(id))
            .map((id) => ({ id, structured_jd: { skills: ["sql"] }, seniority: null, organization_id: null })),
        ),
      );
    }

    if (table === "resumes" && method === "GET") {
      const select = url.searchParams.get("select");
      if (select === "user_id") {
        const limit = Number(url.searchParams.get("limit") ?? Infinity);
        return respond(json((opts.users ?? []).slice(0, limit).map((user_id) => ({ user_id }))));
      }
      return respond(
        json({
          structured_content: {
            contact: { name: "Fixture Seeker" },
            summary: "x",
            experience: [],
            education: [],
            skills: ["sql", "python"],
          },
        }),
      );
    }

    if (table === "match_scores" && method === "GET") {
      const userFilter = url.searchParams.get("user_id")?.replace("eq.", "") ?? "";
      const rows = opts.fullCoverage
        ? opts.postings.map((job_posting_id) => ({ job_posting_id }))
        : [...written.keys()].filter((k) => k.startsWith(`${userFilter}|`)).map((k) => ({ job_posting_id: k.split("|")[1] }));
      return respond(json(rows));
    }

    return respond(json({ message: `fake PostgREST: unhandled ${method} ${table}` }, 500));
  };

  const client = createClient<Database>(FAKE_URL, "fake-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchImpl as typeof fetch },
  });
  return { client, requests, written, deleted };
}

/** The real length of the URL supabase-js builds for `.in("id", <n ids>)` — measured, not modelled. */
async function inUrlLength(n: number): Promise<number> {
  let length = 0;
  const probe = createClient<Database>(FAKE_URL, "fake-key", {
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

const scoredFor = (ids: string[]): ScoredJobLike[] =>
  ids.map((id) => ({
    job: { id },
    score: 50,
    tier: getMatchTier(50),
    explanation: { matchedSkills: [], missingSkills: [], seniorityAlignment: "unknown" },
  }));

// ── output capture + failure-only diagnostics ────────────────────────────────────────────────────────────────

let captured: string[] = [];
beforeEach(() => {
  captured = [];
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      captured.push(`${level}: ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);
    });
  }
});
afterEach(() => vi.restoreAllMocks());

function diag(fake: ReturnType<typeof makeFake>, extra?: unknown): string {
  const req = fake.requests.map((r) => `${r.method} ${r.table} -> ${r.status} urlLength=${r.urlLength}${r.ids ? ` ids=${r.ids}` : ""}`);
  return (
    `\n--- diagnostics (shown only because this assertion failed) ---\n` +
    `${extra === undefined ? "" : `result: ${JSON.stringify(extra)}\n`}` +
    `requests (${req.length}):\n  ${req.join("\n  ")}\n` +
    `job output (${captured.length} lines):\n  ${captured.join("\n  ")}\n`
  );
}

// ── the tests ────────────────────────────────────────────────────────────────────────────────────────────────

const BOARD = 388; // the size CI's own board reached in the failing runs (372–389)

describe("persistScoresOrRetryStale — recovery from a posting deleted mid-run", () => {
  it("the fake refuses what the logs say the gateway refused (guards the test itself)", async () => {
    const limit = await inUrlLength(371);
    expect(await inUrlLength(372), "372 ids must exceed the limit — that is the smallest observed failure").toBeGreaterThan(limit);
    expect(await inUrlLength(BOARD)).toBeGreaterThan(limit);
    expect(await inUrlLength(199), "small lists must be comfortably under it").toBeLessThan(limit);
  });

  it("recovers a full-size batch: drops only the deleted posting, persists the rest", async () => {
    const postings = uuids(BOARD);
    const dead = postings[137];
    const fake = makeFake({ postings, deleted: [dead], urlLimit: await inUrlLength(371) });

    const result = await persistScoresOrRetryStale(fake.client as unknown as SupabaseClient<Database>, "user-a", scoredFor(postings));

    expect(result.ok, `the recovery lost the user's whole batch instead of dropping one stale posting${diag(fake, result)}`).toBe(true);
    expect(result.persisted, diag(fake, result)).toBe(BOARD - 1);
    expect(fake.written.has(`user-a|${dead}`), "the deleted posting must not be written").toBe(false);
    expect(fake.written.size, diag(fake, result)).toBe(BOARD - 1);
  });

  it("no request the recovery makes exceeds the URL limit", async () => {
    const postings = uuids(BOARD);
    const limit = await inUrlLength(371);
    const fake = makeFake({ postings, deleted: [postings[0]], urlLimit: limit });
    await persistScoresOrRetryStale(fake.client as unknown as SupabaseClient<Database>, "user-a", scoredFor(postings));
    const refused = fake.requests.filter((r) => r.status === 414);
    expect(refused, `a request was refused as too long${diag(fake)}`).toEqual([]);
  });

  it.each([1, 2, 199, 200, 201, 372, 388, 600, 1484])(
    "gives the same survivors as a single unlimited lookup at %i postings (equivalence, no URL limit)",
    async (n) => {
      const postings = uuids(n);
      // deterministic scattering of deleted ids, including the first and last
      const dead = new Set([postings[0], postings[n - 1], postings[Math.floor(n / 2)], postings[Math.floor(n / 3)]]);
      // "every posting gone" is its own test below; here at least one must survive. (n === 1 has nothing to delete,
      // so it exercises the clean-upsert path — kept so the equivalence table has no gap.)
      if (n === 1) dead.clear();
      else if (dead.size >= n) dead.delete(postings[n - 1]);
      const fake = makeFake({ postings, deleted: [...dead] });

      const result = await persistScoresOrRetryStale(fake.client as unknown as SupabaseClient<Database>, "user-a", scoredFor(postings));

      const expected = postings.filter((id) => !dead.has(id));
      expect(result.ok, diag(fake, result)).toBe(true);
      expect(result.persisted, diag(fake, result)).toBe(expected.length);
      expect([...fake.written.keys()].map((k) => k.split("|")[1]).sort(), diag(fake, result)).toEqual([...expected].sort());
    },
  );

  it("a list that fits in one chunk still makes exactly ONE lookup, with every id, in order", async () => {
    const postings = uuids(150);
    const fake = makeFake({ postings, deleted: [postings[10]] });
    await persistScoresOrRetryStale(fake.client as unknown as SupabaseClient<Database>, "user-a", scoredFor(postings));
    const lookups = fake.requests.filter((r) => r.table === "job_postings");
    expect(lookups.length, `small batches must not pay for extra round trips${diag(fake)}`).toBe(1);
    expect(lookups[0].ids).toBe(150);
  });

  it("when every posting in the batch is gone it still reports failure, not success", async () => {
    const postings = uuids(BOARD);
    const fake = makeFake({ postings, deleted: postings, urlLimit: await inUrlLength(371) });
    const result = await persistScoresOrRetryStale(fake.client as unknown as SupabaseClient<Database>, "user-a", scoredFor(postings));
    expect(result, diag(fake, result)).toEqual({ persisted: 0, ok: false });
    expect(fake.written.size).toBe(0);
  });

  it("a lookup that genuinely fails still reports failure and logs the same line as before", async () => {
    const postings = uuids(50);
    const fake = makeFake({ postings, deleted: [postings[3]], failLookups: true }); // the upsert reaches 23503, the lookup then fails
    const result = await persistScoresOrRetryStale(fake.client as unknown as SupabaseClient<Database>, "user-a", scoredFor(postings));
    expect(result.ok, diag(fake, result)).toBe(false);
    expect(captured.some((l) => /could not verify stale postings for user-a/.test(l)), diag(fake, result)).toBe(true);
  });

  it("logs a recovery line when it drops stale postings and succeeds; logs nothing when there was nothing to recover", async () => {
    const postings = uuids(BOARD);
    const limit = await inUrlLength(371);

    const recovering = makeFake({ postings, deleted: [postings[5]], urlLimit: limit });
    await persistScoresOrRetryStale(recovering.client as unknown as SupabaseClient<Database>, "user-r", scoredFor(postings));
    expect(
      captured.some((l) => /\[match-score-refresh\] recovered user-r: persisted 387 of 388 .*1 stale posting/.test(l)),
      `no "recovered" line was logged${diag(recovering)}`,
    ).toBe(true);

    captured = [];
    const clean = makeFake({ postings, urlLimit: limit });
    await persistScoresOrRetryStale(clean.client as unknown as SupabaseClient<Database>, "user-c", scoredFor(postings));
    expect(captured.filter((l) => /recovered/.test(l)), diag(clean)).toEqual([]);
  });
});

describe("runMatchScoreRefreshJob — end to end through the real job", () => {
  it("a posting deleted mid-run costs one posting, not the user's whole refresh", async () => {
    const postings = uuids(BOARD);
    const fake = makeFake({
      postings,
      users: ["user-a"],
      deleteOnFirstUpsert: [postings[200]],
      urlLimit: await inUrlLength(371),
    });
    holder.client = fake.client;

    const summary = await runMatchScoreRefreshJob();

    expect(summary.failed, `the job lost a user's refresh to a single deleted posting${diag(fake, summary)}`).toBe(0);
    expect(summary.usersRefreshed, diag(fake, summary)).toBe(1);
    expect(summary.postingsScored, diag(fake, summary)).toBe(BOARD - 1);
    expect(summary.ok, diag(fake, summary)).toBe(true);
    expect(summary.errors, diag(fake, summary)).toEqual([]);
  });

  it("warns once the candidate-user query reaches 80% of MAX_USERS_PER_RUN (500), and not before", async () => {
    // MAX_USERS_PER_RUN is a private const (500); its value is pinned here on purpose — if it changes, this test says so.
    const postings = uuids(20);

    const at399 = makeFake({ postings, users: uuids(399, 5000), fullCoverage: true });
    holder.client = at399.client;
    await runMatchScoreRefreshJob();
    expect(captured.filter((l) => /MAX_USERS_PER_RUN/.test(l)), `warned below 80%${diag(at399)}`).toEqual([]);

    captured = [];
    const at400 = makeFake({ postings, users: uuids(400, 5000), fullCoverage: true });
    holder.client = at400.client;
    const summary = await runMatchScoreRefreshJob();
    expect(summary.usersConsidered, diag(at400, summary)).toBe(400);
    expect(
      captured.some((l) => /^warn: \[match-score-refresh\].*400.*MAX_USERS_PER_RUN.*500/.test(l)),
      `no capacity warning at 400/500 users${diag(at400, summary)}`,
    ).toBe(true);
  });
});
