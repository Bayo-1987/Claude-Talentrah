/**
 * Cross-source dedup: a schema-org Workable search page (e.g.
 * `workable-abuja`) and the new per-company `workable` source both surfacing
 * the SAME real posting must collapse to one row, not two — this is
 * requirement #4 of the Kuda round (see sources.config.ts's WORKABLE COMPANY
 * BOARDS section): Kuda's "Direct Sales Agent" is already ingested via
 * `workable-abuja`, and the new `kuda` account entry sees it again.
 *
 * Every other cross-source dedup test in this repo
 * (ingest-schema-org-multi-source.test.ts) covers two schema-org configs.
 * This is a genuinely different pairing — one schema-org, one a brand-new
 * source TYPE — and `computeDedupFingerprint` doesn't know or care what
 * fetched a posting, only company+title+location, so nothing about the
 * dedup logic itself is new. What IS new, and what this proves rather than
 * assumes: the two fetchers produce a company name, title and location for
 * the same real job that actually canonicalize to the same fingerprint, and
 * `ingestAllSources`'s "last config wins" rule (array order) attributes the
 * surviving row to whichever source is placed later — the reason
 * sources.config.ts places `workable`/kuda AFTER `workable-abuja`.
 *
 * Network is mocked (both fetchers hit their REAL hardcoded hosts —
 * jobs.workable.test below stands in for jobs.workable.com's shape only in
 * the URL path, the workable fetcher itself is NOT mocked and calls the real
 * `apply.workable.com` host, intercepted by the stubbed global fetch below
 * using a random per-run token so it can never collide with a real account);
 * Supabase is not — same split as every other ingest-* test in this
 * directory.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`workable dedup ingest test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { RUN_ID, COMPANY, TOKEN, ABUJA_LISTING_URL, ABUJA_JOB_URL, WIDGET_URL } = vi.hoisted(() => {
  const runId = Math.random().toString(36).slice(2, 10);
  const token = `testkuda${runId}`;
  return {
    RUN_ID: runId,
    COMPANY: `Test Kuda Dedup ${runId}`,
    TOKEN: token,
    ABUJA_LISTING_URL: `https://jobs.workable.test/${runId}/search/abuja`,
    ABUJA_JOB_URL: `https://jobs.workable.test/${runId}/view/direct-sales-agent`,
    // fetchWorkableJobs hardcodes this exact host/path shape — see
    // sources/workable.ts — only the account token varies, so a unique
    // per-run token is what makes this interceptable without mocking the
    // module itself.
    WIDGET_URL: `https://apply.workable.com/api/v1/widget/accounts/${token}?details=true`,
  };
});

vi.mock("@/lib/jobs/sources.config", () => ({
  JOB_SOURCES: [
    { source: "schema-org", url: ABUJA_LISTING_URL, label: `test-workable-abuja-${RUN_ID}` },
    { source: "workable", token: TOKEN, companyName: COMPANY },
  ],
}));

const realFetch = globalThis.fetch;

function htmlWithJsonLd(...blocks: unknown[]): string {
  const scripts = blocks
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
    .join("\n");
  return `<!doctype html><html><head>${scripts}</head><body></body></html>`;
}

const itemList = (urls: string[]) => ({
  "@type": "ItemList",
  itemListElement: urls.map((url, i) => ({ "@type": "ListItem", position: i, url })),
});

async function statuses(): Promise<Array<{ title: string; status: string; external_source: string | null }>> {
  const { data, error } = await admin
    .from("job_postings")
    .select("title, status, external_source")
    .eq("company_name", COMPANY);
  if (error) throw error;
  return data ?? [];
}

async function cleanup() {
  await admin.from("job_postings").delete().eq("company_name", COMPANY);
}

afterAll(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe("a posting reachable via both a schema-org Workable search page and the per-company workable source", () => {
  it("collapses to one row, attributed to whichever source runs LAST in JOB_SOURCES", async () => {
    await cleanup();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);

        if (url === ABUJA_LISTING_URL) {
          return {
            ok: true,
            status: 200,
            text: async () => htmlWithJsonLd(itemList([ABUJA_JOB_URL])),
          };
        }
        if (url === ABUJA_JOB_URL) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              htmlWithJsonLd({
                "@type": "JobPosting",
                title: "Direct Sales Agent",
                datePosted: "2026-06-03T00:00:00.000Z",
                hiringOrganization: { "@type": "Organization", name: COMPANY },
                jobLocation: {
                  "@type": "Place",
                  address: {
                    "@type": "PostalAddress",
                    addressLocality: "Abuja",
                    addressRegion: "Federal Capital Territory",
                    addressCountry: "Nigeria",
                  },
                },
              }),
          };
        }
        if (url === WIDGET_URL) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              name: COMPANY,
              jobs: [
                {
                  title: "Direct Sales Agent",
                  shortcode: "DSATEST01",
                  employment_type: "Full-time",
                  telecommuting: false,
                  url: "https://apply.workable.test/j/DSATEST01",
                  published_on: "2026-06-03",
                  country: "Nigeria",
                  city: "Abuja",
                  state: "Federal Capital Territory",
                  description: "<p>Drive Kuda growth in Abuja.</p>",
                },
                {
                  title: "Backend Engineer",
                  shortcode: "BETEST02",
                  employment_type: "Full-time",
                  telecommuting: false,
                  url: "https://apply.workable.test/j/BETEST02",
                  published_on: "2026-07-31",
                  country: "Nigeria",
                  city: "Lagos",
                  state: "Lagos",
                  description: "<p>Ship backend services.</p>",
                },
              ],
            }),
          };
        }
        // Precise, not a bare `.includes("workable")` — the real Supabase
        // REST calls below carry `external_source=eq.schema-org%3Atest-
        // workable-abuja-<run>` in their OWN query string, which contains
        // the substring "workable" too and must fall through to realFetch.
        if (url.startsWith("https://jobs.workable.test/") || url === WIDGET_URL) {
          throw new Error(`unstubbed test URL: ${url}`);
        }
        return realFetch(input as Parameters<typeof fetch>[0]);
      }),
    );

    const { ingestAllSources } = await import("@/lib/jobs/ingest");
    const results = await ingestAllSources();
    for (const r of results) expect(r.error, `ingest reported an error: ${r.error}`).toBeUndefined();

    const rows = await statuses();

    const dsaRows = rows.filter((r) => r.title === "Direct Sales Agent");
    expect(
      dsaRows,
      `expected exactly one Direct Sales Agent row after dedup, found ${dsaRows.length}: ${JSON.stringify(dsaRows)}`,
    ).toHaveLength(1);
    expect(
      dsaRows[0]?.external_source,
      "the LATER config in JOB_SOURCES order (the per-company workable source) must own the surviving row",
    ).toBe("workable");
    expect(dsaRows[0]?.status).toBe("open");

    // Positive control: Backend Engineer only ever comes from the workable
    // source and must still land normally alongside the deduped row.
    const beRows = rows.filter((r) => r.title === "Backend Engineer");
    expect(beRows).toHaveLength(1);
    expect(beRows[0]?.external_source).toBe("workable");
  });
});
