/**
 * An empty fetch must not close a whole source's live postings.
 *
 * THE FAILURE MODE. The freshness sweep closes anything it did not just see:
 *
 *     seenFingerprints = jobs.map(j => j.dedupFingerprint)
 *     update job_postings set status = 'closed'
 *       where external_source = <source> and status = 'open'
 *         and dedup_fingerprint not in (<seenFingerprints>)
 *
 * When `jobs` is empty, "anything I did not just see" is *everything*. A board
 * that answers 200 with an empty array — a deploy, a rate limit answered
 * politely, a JSON-LD change on a listing page — silently closes every posting
 * for that source. The next run reopens them, so the damage is a window rather
 * than permanent, but during it the feed is missing real jobs and nothing
 * anywhere says so.
 *
 * `ingest.ts` has documented this in a comment since the Greenhouse days and
 * pointed at a brief (`test-scenarios-job-feed-matching-prompt.md`) that is not
 * in this repo — which is a fair part of why it stayed unfixed. PR #39 then
 * widened the blast radius: a schema-org source closes by SOURCE rather than by
 * company, so one empty listing page takes out every employer on it, not one.
 *
 * These tests drive the real `ingestAllSources` against the real database with
 * only the fetch mocked, because the sweep is a database behaviour.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { admin } from "../support/auth";

/*
 * vi.hoisted, not plain consts: vi.mock's factory is hoisted above ordinary
 * top-level declarations, so a const referenced inside it would be a TDZ error
 * — and reading it from process.env in a beforeAll would be worse, because the
 * factory runs at import time, long before any hook.
 */
const { RUN, LISTING, JOB_A, JOB_B, COMPANY } = vi.hoisted(() => {
  const run = Math.random().toString(36).slice(2, 10);
  return {
    RUN: run,
    LISTING: `https://empty-guard.test/${run}/search`,
    JOB_A: `https://empty-guard.test/${run}/view/a`,
    JOB_B: `https://empty-guard.test/${run}/view/b`,
    COMPANY: `Empty Guard Co ${run}`,
  };
});

vi.mock("@/lib/jobs/sources.config", () => ({
  JOB_SOURCES: [{ source: "schema-org", url: LISTING, label: `empty-guard-${RUN}` }],
}));

const realFetch = globalThis.fetch;

function html(...blocks: unknown[]): string {
  return `<!doctype html><html><head>${blocks
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
    .join("")}</head><body></body></html>`;
}
const itemList = (urls: string[]) => ({
  "@type": "ItemList",
  itemListElement: urls.map((url, i) => ({ "@type": "ListItem", position: i, url })),
});
const posting = (title: string) => ({
  "@type": "JobPosting",
  title,
  datePosted: new Date().toISOString(),
  hiringOrganization: { "@type": "Organization", name: COMPANY },
  jobLocationType: "TELECOMMUTE",
});

/** Routes the test's own URLs; everything else (Supabase) hits the network. */
function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: unknown) => {
      const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
      if (url in routes) return { ok: true, status: 200, text: async () => html(routes[url]) };
      if (url.includes("empty-guard.test")) throw new Error(`unstubbed test URL: ${url}`);
      return realFetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
    }),
  );
}

async function statuses(): Promise<string[]> {
  const { data } = await admin
    .from("job_postings")
    .select("status")
    .eq("company_name", COMPANY);
  return (data ?? []).map((r) => r.status).sort();
}

beforeEach(async () => {
  await admin.from("job_postings").delete().eq("company_name", COMPANY);
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await admin.from("job_postings").delete().eq("company_name", COMPANY);
});

describe("an empty fetch does not wipe the source", () => {
  it("THE BUG: zero jobs returned closes every open posting for the source", async () => {
    const { ingestAllSources } = await import("@/lib/jobs/ingest");

    // Run 1: two live postings.
    mockFetch({
      [LISTING]: itemList([JOB_A, JOB_B]),
      [JOB_A]: posting("Role A"),
      [JOB_B]: posting("Role B"),
    });
    await ingestAllSources();
    expect(await statuses(), "fixture should have two open postings").toEqual(["open", "open"]);

    // Run 2: the board answers 200 with nothing. A deploy, a rate limit
    // answered politely, a markup change — not a statement that the jobs
    // are gone.
    vi.unstubAllGlobals();
    mockFetch({ [LISTING]: itemList([]) });
    const results = await ingestAllSources();

    expect(
      await statuses(),
      "FEED WIPED: an empty response closed every live posting for this source",
    ).toEqual(["open", "open"]);

    const mine = results.find((r) => r.source === "schema-org");
    expect(mine?.closed, "nothing should have been closed").toBe(0);
  });

  it("reports the skip rather than passing silently", async () => {
    const { ingestAllSources } = await import("@/lib/jobs/ingest");

    mockFetch({ [LISTING]: itemList([JOB_A]), [JOB_A]: posting("Role A") });
    await ingestAllSources();

    vi.unstubAllGlobals();
    mockFetch({ [LISTING]: itemList([]) });
    const results = await ingestAllSources();
    const mine = results.find((r) => r.source === "schema-org");

    expect(
      mine?.closureSkipped,
      "a source serving stale postings must be visible in the run summary, not inferred from closed:0",
    ).toBe(true);
  });
});

describe("what the guard must not break", () => {
  it("a source that legitimately shrinks still closes the postings that went away", async () => {
    /*
     * The guard must not become "never close anything". Normal turnover — one
     * posting disappears while others remain — is the case the sweep exists
     * for, and a non-empty fetch is a real statement about what is live.
     */
    const { ingestAllSources } = await import("@/lib/jobs/ingest");

    mockFetch({
      [LISTING]: itemList([JOB_A, JOB_B]),
      [JOB_A]: posting("Role A"),
      [JOB_B]: posting("Role B"),
    });
    await ingestAllSources();
    expect(await statuses()).toEqual(["open", "open"]);

    vi.unstubAllGlobals();
    mockFetch({ [LISTING]: itemList([JOB_A]), [JOB_A]: posting("Role A") });
    await ingestAllSources();

    expect(
      await statuses(),
      "shrinking from two to one must still close the one that went away",
    ).toEqual(["closed", "open"]);
  });

  it("an empty fetch against a source with nothing open is a no-op, not a skip", async () => {
    // Nothing to protect, so there is nothing to report either — the guard
    // should not cry wolf on a source that is simply empty.
    const { ingestAllSources } = await import("@/lib/jobs/ingest");
    mockFetch({ [LISTING]: itemList([]) });
    const results = await ingestAllSources();
    const mine = results.find((r) => r.source === "schema-org");
    expect(mine?.closed).toBe(0);
    expect(mine?.closureSkipped ?? false, "no open postings existed, so nothing was withheld").toBe(false);
  });
});
