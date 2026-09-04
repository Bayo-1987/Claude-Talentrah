/**
 * The closure sweep's stale-id batching (Stage 2).
 *
 * ingestAllSources() used to close postings via
 * `.not("dedup_fingerprint", "in", <every fingerprint fetched this run>)` —
 * a filter value that grows with the SOURCE's size and has no ceiling.
 * Moniepoint alone is past 100 open postings; a real source only grows.
 * Inverted instead: fetch the currently-open rows (no fingerprint list in
 * that query at all), diff against what was just fetched in JS, and close
 * by `.in("id", staleIds)` — a list that is normally small (just what
 * disappeared) rather than everything still open, chunked defensively so a
 * source that goes from fully-populated to empty between runs can't
 * reproduce the same problem on the OTHER side of the diff.
 *
 * This only exercises the closure path with enough stale rows to cross one
 * batch boundary — the semantic behaviour (empty-fetch guard, cross-source
 * scoping, dedup collisions) is already covered elsewhere
 * (empty-fetch-guard*.test.ts, dedup-collisions.test.ts, ingest-schema-org*
 * .test.ts) and none of those fixtures are large enough to touch batching at
 * all, which is exactly why this is a separate file rather than an addition
 * to one of them.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin } from "../support/auth";

const { TOKEN, COMPANY, BOARD_URL } = vi.hoisted(() => {
  const run = Math.random().toString(36).slice(2, 10);
  return {
    TOKEN: `closebatch${run}`,
    COMPANY: `Close Batch GH ${run}`,
    BOARD_URL: `https://boards-api.greenhouse.io/v1/boards/closebatch${run}/jobs?content=true`,
  };
});

vi.mock("@/lib/jobs/sources.config", () => ({
  JOB_SOURCES: [{ source: "greenhouse", token: TOKEN, companyName: COMPANY }],
}));

const realFetch = globalThis.fetch;

function board(jobs: Array<{ id: number; title: string; location: string }>) {
  return {
    jobs: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      location: { name: j.location },
      absolute_url: `https://boards.greenhouse.io/${TOKEN}/jobs/${j.id}`,
      content: "<p>A role.</p>",
      updated_at: new Date().toISOString(),
    })),
  };
}

function mockBoard(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: unknown) => {
      const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
      if (url === BOARD_URL) {
        return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
      }
      if (url.includes("greenhouse.io")) throw new Error(`unstubbed board URL: ${url}`);
      return realFetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
    }),
  );
}

async function statusCounts() {
  const { data } = await admin.from("job_postings").select("status").eq("company_name", COMPANY);
  const rows = data ?? [];
  return {
    total: rows.length,
    open: rows.filter((r) => r.status === "open").length,
    closed: rows.filter((r) => r.status === "closed").length,
  };
}

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await admin.from("job_postings").delete().eq("company_name", COMPANY);
});

describe("closing more stale postings than fit in one batch", () => {
  it("closes every stale row, not just the first CLOSE_BATCH_SIZE", async () => {
    // 250 pre-existing "open" rows for this company, none of which will be
    // in the fetched board below — every one of them is stale. 250 crosses
    // the 200-per-batch boundary the ingest module uses, so this only passes
    // if the loop actually iterates rather than handling one batch and
    // stopping.
    const staleRows = Array.from({ length: 250 }, (_, i) => ({
      source_type: "external" as const,
      organization_id: null,
      company_name: COMPANY,
      title: `Stale Role ${i}`,
      description: "Will be closed this run.",
      status: "open" as const,
      external_source: "greenhouse",
      external_url: `https://boards.greenhouse.io/${TOKEN}/jobs/stale-${i}`,
      posted_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
      dedup_fingerprint: `${TOKEN}-stale-${i}-${randomUUID()}`,
    }));
    const { error } = await admin.from("job_postings").insert(staleRows);
    if (error) throw new Error(`fixture insert failed: ${error.message}`);

    expect((await statusCounts()).open, "fixture setup: all 250 should start open").toBe(250);

    // The board this run actually returns: one real, surviving posting —
    // everything else is implicitly stale.
    mockBoard(board([{ id: 1, title: "Backend Engineer", location: "Lagos, Nigeria" }]));
    const { ingestAllSources } = await import("@/lib/jobs/ingest");
    const results = await ingestAllSources();

    const after = await statusCounts();
    expect(after.total, "the survivor was upserted alongside the 250 fixtures").toBe(251);
    expect(
      after.closed,
      "SABOTAGE-PROOF TARGET: every stale row must close, not just the first batch",
    ).toBe(250);
    expect(after.open).toBe(1);
    expect(results[0]?.closed).toBe(250);
  });
});
