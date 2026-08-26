/**
 * The empty-fetch guard on the COMPANY-scoped closure path.
 *
 * `tests/jobs/empty-fetch-guard.test.ts` covers the schema-org path, which
 * scopes closure to the whole source. Greenhouse/Lever take the other branch —
 * scoped to `config.companyName` — and it is a genuinely different code path
 * through the same guard, so testing one and assuming the other is exactly the
 * assumption this repo keeps getting caught by.
 *
 * The blast radius is smaller here (one company rather than every employer on
 * a listing) but the failure is identical in kind: a board answering 200 with
 * `{"jobs": []}` used to close every posting that company had.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { admin } from "../support/auth";

const { TOKEN, COMPANY, BOARD_URL } = vi.hoisted(() => {
  const run = Math.random().toString(36).slice(2, 10);
  return {
    TOKEN: `emptyguard${run}`,
    COMPANY: `Empty Guard GH ${run}`,
    BOARD_URL: `https://boards-api.greenhouse.io/v1/boards/emptyguard${run}/jobs?content=true`,
  };
});

vi.mock("@/lib/jobs/sources.config", () => ({
  JOB_SOURCES: [{ source: "greenhouse", token: TOKEN, companyName: COMPANY }],
}));

const realFetch = globalThis.fetch;

/** Greenhouse's board payload, trimmed to what the fetcher reads. */
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

async function statuses(): Promise<string[]> {
  const { data } = await admin.from("job_postings").select("status").eq("company_name", COMPANY);
  return (data ?? []).map((r) => r.status).sort();
}

beforeEach(async () => {
  await admin.from("job_postings").delete().eq("company_name", COMPANY);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await admin.from("job_postings").delete().eq("company_name", COMPANY);
});

describe("company-scoped closure honours the same guard", () => {
  it("an empty board does not close that company's live postings", async () => {
    const { ingestAllSources } = await import("@/lib/jobs/ingest");

    mockBoard(board([
      { id: 1, title: "Backend Engineer", location: "Lagos, Nigeria" },
      { id: 2, title: "Product Designer", location: "Lagos, Nigeria" },
    ]));
    await ingestAllSources();
    expect(await statuses()).toEqual(["open", "open"]);

    vi.unstubAllGlobals();
    mockBoard(board([]));
    const results = await ingestAllSources();

    expect(
      await statuses(),
      "FEED WIPED: an empty board response closed this company's live postings",
    ).toEqual(["open", "open"]);
    expect(results[0]?.closed).toBe(0);
    expect(results[0]?.closureSkipped, "the skip must be reported, not inferred from closed:0").toBe(true);
  });

  it("a board that legitimately shrinks still closes what went away", async () => {
    // The guard must not become "never close". A non-empty response is a real
    // statement about what is live.
    const { ingestAllSources } = await import("@/lib/jobs/ingest");

    mockBoard(board([
      { id: 1, title: "Backend Engineer", location: "Lagos, Nigeria" },
      { id: 2, title: "Product Designer", location: "Lagos, Nigeria" },
    ]));
    await ingestAllSources();

    vi.unstubAllGlobals();
    mockBoard(board([{ id: 1, title: "Backend Engineer", location: "Lagos, Nigeria" }]));
    const results = await ingestAllSources();

    expect(await statuses()).toEqual(["closed", "open"]);
    expect(results[0]?.closureSkipped ?? false, "a non-empty fetch is evidence; nothing was withheld").toBe(false);
  });
});
