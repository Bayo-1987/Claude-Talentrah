/**
 * schema.org ingestion, end-to-end through `ingestAllSources()` against the
 * live database (this repo has no staging DB — see CLAUDE.md). Network is
 * mocked (no real HTTP to Workable); Supabase is not.
 *
 * Two things this proves that the unit tests in schema-org.test.ts can't:
 *   1. rows actually land in `job_postings` with `source_type: 'external'`
 *      and `external_source: 'schema-org'`, through the real upsert path.
 *   2. the freshness/closure sweep in ingest.ts — for a schema-org source,
 *      scoped to the whole source (not a single company, since one listing
 *      URL can span many hiring organizations) — closes a posting that
 *      drops off the listing while leaving a still-listed one untouched.
 *
 * `sources.config` is mocked to a single throwaway schema-org source so this
 * test doesn't also depend on the real Moniepoint Greenhouse API being up.
 *
 * RUN_ID/urls are computed via vi.hoisted because vi.mock's factory is
 * hoisted above regular top-level const declarations — a plain const here
 * would be a TDZ reference error inside the factory.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { ingestAllSources } from "@/lib/jobs/ingest";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`schema-org ingest test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Unique per run so repeated CI runs never collide on dedup_fingerprint.
const { RUN_ID, COMPANY_A, COMPANY_B, LISTING_URL, JOB_A_URL, JOB_B_URL } = vi.hoisted(() => {
  const runId = Math.random().toString(36).slice(2, 10);
  return {
    RUN_ID: runId,
    COMPANY_A: `Test Schema Org Co A ${runId}`,
    COMPANY_B: `Test Schema Org Co B ${runId}`,
    LISTING_URL: `https://jobs.workable.test/${runId}/search/nigeria`,
    JOB_A_URL: `https://jobs.workable.test/${runId}/view/a`,
    JOB_B_URL: `https://jobs.workable.test/${runId}/view/b`,
  };
});

function htmlWithJsonLd(...blocks: unknown[]): string {
  const scripts = blocks
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
    .join("\n");
  return `<!doctype html><html><head>${scripts}</head><body></body></html>`;
}

function itemList(urls: string[]) {
  return {
    "@type": "ItemList",
    itemListElement: urls.map((url, i) => ({ "@type": "ListItem", position: i, url })),
  };
}

function jobPosting(company: string, title: string) {
  return {
    "@type": "JobPosting",
    title,
    datePosted: new Date().toISOString(),
    hiringOrganization: { "@type": "Organization", name: company },
    jobLocationType: "TELECOMMUTE",
  };
}

vi.mock("@/lib/jobs/sources.config", () => ({
  JOB_SOURCES: [{ source: "schema-org", url: LISTING_URL, label: `test-${RUN_ID}` }],
}));

let fetchMock: ReturnType<typeof vi.fn>;

function mockListing(urls: string[], postingsByUrl: Record<string, unknown>) {
  fetchMock = vi.fn(async (url: string) => {
    if (url === LISTING_URL) {
      return { ok: true, status: 200, text: async () => htmlWithJsonLd(itemList(urls)) };
    }
    const posting = postingsByUrl[url];
    if (!posting) throw new Error(`unexpected fetch in test: ${url}`);
    return { ok: true, status: 200, text: async () => htmlWithJsonLd(posting) };
  });
  vi.stubGlobal("fetch", fetchMock);
}

afterAll(async () => {
  await admin
    .from("job_postings")
    .delete()
    .in("company_name", [COMPANY_A, COMPANY_B]);
  vi.unstubAllGlobals();
});

describe("ingestAllSources — schema-org source", () => {
  it("upserts both jobs as external/schema-org rows on the first run", async () => {
    mockListing([JOB_A_URL, JOB_B_URL], {
      [JOB_A_URL]: jobPosting(COMPANY_A, "Role A"),
      [JOB_B_URL]: jobPosting(COMPANY_B, "Role B"),
    });

    const results = await ingestAllSources();
    const mine = results.find((r) => r.source === "schema-org");
    expect(mine).toBeDefined();
    expect(mine!.error).toBeUndefined();
    expect(mine!.fetched).toBe(2);
    expect(mine!.upserted).toBeGreaterThanOrEqual(2);

    const { data: rows, error } = await admin
      .from("job_postings")
      .select("company_name, title, source_type, external_source, status")
      .in("company_name", [COMPANY_A, COMPANY_B]);
    if (error) throw error;

    expect(rows).toHaveLength(2);
    for (const row of rows!) {
      expect(row.source_type).toBe("external");
      expect(row.external_source).toBe("schema-org");
      expect(row.status).toBe("open");
    }
  });

  it("closes the posting that disappears on a second run, and leaves the one that's still there open", async () => {
    // Second run: Company B's role is gone from the listing (e.g. filled),
    // Company A's is still there — same shape as an existing Greenhouse
    // listing that stops appearing in a later board fetch.
    mockListing([JOB_A_URL], {
      [JOB_A_URL]: jobPosting(COMPANY_A, "Role A"),
    });

    const results = await ingestAllSources();
    const mine = results.find((r) => r.source === "schema-org");
    expect(mine!.error).toBeUndefined();
    expect(mine!.fetched).toBe(1);
    expect(mine!.closed).toBeGreaterThanOrEqual(1);

    const { data: rows, error } = await admin
      .from("job_postings")
      .select("company_name, status")
      .in("company_name", [COMPANY_A, COMPANY_B]);
    if (error) throw error;

    const a = rows!.find((r) => r.company_name === COMPANY_A);
    const b = rows!.find((r) => r.company_name === COMPANY_B);
    expect(a?.status).toBe("open");
    expect(b?.status).toBe("closed");
  });
});
