/**
 * schema.org ingestion, end-to-end through `ingestAllSources()` against the
 * live database (this repo has no staging DB — see CLAUDE.md). Network is
 * mocked (no real HTTP to Workable); Supabase is not.
 *
 * Two things this proves that the unit tests in schema-org.test.ts can't:
 *   1. rows actually land in `job_postings` with `source_type: 'external'`
 *      and `external_source: 'schema-org:<label>'`, through the real upsert
 *      path.
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
import { computeDedupFingerprint } from "@/lib/jobs/dedup";
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

function jobPosting(
  company: string,
  title: string,
  extra: { validThrough?: string; baseSalary?: unknown } = {},
) {
  return {
    "@type": "JobPosting",
    title,
    datePosted: new Date().toISOString(),
    hiringOrganization: { "@type": "Organization", name: company },
    jobLocationType: "TELECOMMUTE",
    ...extra,
  };
}

vi.mock("@/lib/jobs/sources.config", () => ({
  JOB_SOURCES: [{ source: "schema-org", url: LISTING_URL, label: `test-${RUN_ID}` }],
}));

let fetchMock: ReturnType<typeof vi.fn>;

/**
 * The real fetch, captured before anything stubs it.
 *
 * `vi.stubGlobal("fetch", ...)` replaces the ONE global that supabase-js also
 * uses, so a mock that throws on any unrecognised URL intercepts Supabase's
 * own REST calls, not just the fetcher's. That is what happened here: both
 * cases failed with
 *
 *   unexpected fetch in test: https://<project>.supabase.co/rest/v1/job_postings
 *     ?on_conflict=dedup_fingerprint&columns=...
 *     at Module.ingestAllSources (src/lib/jobs/ingest.ts:86)   <- the upsert
 *
 * which contradicts this file's own stated contract at the top: "Network is
 * mocked (no real HTTP to Workable); Supabase is not." Anything that is not
 * one of this test's own throwaway URLs is therefore passed through to the
 * real implementation, so Supabase reaches the live project as intended while
 * Workable is never contacted.
 */
const realFetch = globalThis.fetch;

function mockListing(urls: string[], postingsByUrl: Record<string, unknown>) {
  fetchMock = vi.fn(async (input: unknown, init?: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);

    if (url === LISTING_URL) {
      return { ok: true, status: 200, text: async () => htmlWithJsonLd(itemList(urls)) };
    }
    const posting = postingsByUrl[url];
    if (posting) {
      return { ok: true, status: 200, text: async () => htmlWithJsonLd(posting) };
    }

    // A URL this test owns but did not stub for this run is a genuine test
    // bug — surface it rather than silently letting it hit the network.
    if (url.startsWith(`https://jobs.workable.test/${RUN_ID}/`)) {
      throw new Error(`unexpected fetch of a test-owned URL: ${url}`);
    }

    // Everything else — Supabase — goes to the real thing.
    return realFetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
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
      expect(row.external_source).toBe(`schema-org:test-${RUN_ID}`);
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

/**
 * validThrough and baseSalary through the REAL upsert, not just the fetcher
 * — closing the Search Console gap end to end. Own describe block and own
 * company names so its cleanup can't race the suite above's.
 */
describe("ingestAllSources — schema-org validThrough/baseSalary reach the row", () => {
  const COMPANY_C = `Test Schema Org Co C ${RUN_ID}`;
  const JOB_C_URL = `https://jobs.workable.test/${RUN_ID}/view/c`;

  afterAll(async () => {
    await admin.from("job_postings").delete().eq("company_name", COMPANY_C);
  });

  it("writes expires_at from validThrough and salary_* from baseSalary on a real row", async () => {
    mockListing([JOB_C_URL], {
      [JOB_C_URL]: jobPosting(COMPANY_C, "Role C", {
        validThrough: "2099-12-31T00:00:00.000Z",
        baseSalary: {
          "@type": "MonetaryAmount",
          currency: "ngn",
          value: { "@type": "QuantitativeValue", minValue: 500000, maxValue: 800000, unitText: "MONTH" },
        },
      }),
    });

    const results = await ingestAllSources();
    const mine = results.find((r) => r.source === "schema-org");
    expect(mine!.error).toBeUndefined();

    const { data: row, error } = await admin
      .from("job_postings")
      .select("expires_at, salary_min, salary_max, salary_currency, salary_unit")
      .eq("company_name", COMPANY_C)
      .single();
    if (error) throw error;

    // Postgres reformats the timestamp on the way back ("+00:00" vs. "Z") —
    // compare the instant, not the string, same trap
    // tests/scholarships/return-to-review.test.ts documents for scholarships.
    expect(new Date(row.expires_at!).getTime()).toBe(new Date("2099-12-31T00:00:00.000Z").getTime());
    expect(row.salary_min).toBe(500000);
    expect(row.salary_max).toBe(800000);
    expect(row.salary_currency).toBe("NGN");
    expect(row.salary_unit).toBe("month");
  });

  it("a listing with neither leaves both columns null — the ordinary case, not a regression", async () => {
    // Reruns the FIRST suite's plain jobPosting() shape (no validThrough/
    // baseSalary) through the real upsert, confirming the new columns don't
    // turn "source said nothing" into an accidental non-null default.
    const plainUrl = `https://jobs.workable.test/${RUN_ID}/view/c-plain`;
    mockListing([plainUrl], { [plainUrl]: jobPosting(COMPANY_C, "Role C Plain") });

    await ingestAllSources();

    const { data: row, error } = await admin
      .from("job_postings")
      .select("expires_at, salary_min, salary_currency")
      .eq("company_name", COMPANY_C)
      .eq("title", "Role C Plain")
      .single();
    if (error) throw error;

    expect(row.expires_at).toBeNull();
    expect(row.salary_min).toBeNull();
    expect(row.salary_currency).toBeNull();
  });
});

/**
 * WHY THIS EXISTS: proving "no backfill needed", rather than asserting it.
 *
 * The hybrid mapping fix (schema-org.ts's `mapWorkType`) left 28 production
 * rows carrying a physical address while stored as `work_type = 'remote'`.
 * The claim made in its place of a migration is that `ingest.ts` upserts on
 * `dedup_fingerprint` and writes `work_type` unconditionally on every run, so
 * the next scheduled ingest rewrites those rows on its own.
 *
 * That claim is only true if the fingerprint is UNCHANGED by the fix, which
 * is the part worth pinning: `computeDedupFingerprint` is built from
 * company + title + LOCATION, and the fix deliberately does not alter
 * `formatLocation`'s output — a hybrid row's location was already the
 * physical address, both before and after. Had the location moved, the upsert
 * would insert a NEW row and quietly strand the stale one as an open
 * duplicate, and a backfill really would be required.
 *
 * So this seeds the exact pre-fix production state — right fingerprint, right
 * physical location, wrong `work_type` — and asserts the next
 * `ingestAllSources()` flips THE SAME ROW (asserted by id) to `hybrid`.
 */
describe("ingestAllSources — a stale 'remote' hybrid row self-corrects on the next run", () => {
  const COMPANY_D = `Test Schema Org Co D ${RUN_ID}`;
  const JOB_D_URL = `https://jobs.workable.test/${RUN_ID}/view/hybrid-role-in-cape-town`;
  const TITLE_D = "Graduate Software Developer";
  const LOCATION_D = "Cape Town, Western Cape, South Africa";

  /** The Clickatell shape the production audit found: TELECOMMUTE kept
   * alongside a fully populated physical address. */
  const hybridPosting = {
    "@type": "JobPosting",
    title: TITLE_D,
    datePosted: new Date().toISOString(),
    hiringOrganization: { "@type": "Organization", name: COMPANY_D },
    jobLocationType: "TELECOMMUTE",
    jobLocation: {
      "@type": "Place",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Cape Town",
        addressRegion: "Western Cape",
        addressCountry: "South Africa",
      },
    },
  };

  afterAll(async () => {
    const { error } = await admin.from("job_postings").delete().eq("company_name", COMPANY_D);
    // A rejected Supabase delete resolves with an `error` rather than
    // throwing — see CLAUDE.md. Surface it instead of leaking test rows.
    if (error) throw error;
  });

  it("rewrites work_type in place on the existing row — no migration, no backfill", async () => {
    const fingerprint = computeDedupFingerprint(COMPANY_D, TITLE_D, LOCATION_D);

    // 1. Seed the stale, pre-fix state exactly as production holds it.
    const { data: seeded, error: seedError } = await admin
      .from("job_postings")
      .insert({
        source_type: "external",
        organization_id: null,
        title: TITLE_D,
        company_name: COMPANY_D,
        location: LOCATION_D,
        work_type: "remote", // the bug: physical address, stored fully remote
        description: "seeded stale row",
        structured_jd: {},
        external_url: JOB_D_URL,
        external_source: `schema-org:test-${RUN_ID}`,
        status: "open",
        posted_at: new Date().toISOString(),
        dedup_fingerprint: fingerprint,
      })
      .select("id, work_type, location")
      .single();
    if (seedError) throw seedError;

    expect(seeded.work_type, "precondition: the row starts in the buggy state").toBe("remote");

    // 2. One ordinary ingest run — the same code path the daily job runs.
    mockListing([JOB_D_URL], { [JOB_D_URL]: hybridPosting });
    const results = await ingestAllSources();
    const mine = results.find((r) => r.source === "schema-org");
    expect(mine!.error).toBeUndefined();

    // 3. The SAME row (by id) is now hybrid. Fetching by id rather than by
    //    company is the whole point: a changed fingerprint would have
    //    inserted a second row and left this one untouched.
    const { data: after, error: afterError } = await admin
      .from("job_postings")
      .select("id, work_type, location, dedup_fingerprint")
      .eq("id", seeded.id)
      .single();
    if (afterError) throw afterError;

    expect(after.work_type).toBe("hybrid");
    expect(after.dedup_fingerprint, "the fingerprint must not move, or this is an insert").toBe(fingerprint);
    expect(after.location, "the physical location was already correct and must not change").toBe(LOCATION_D);

    // And no duplicate was created alongside it.
    const { data: all, error: allError } = await admin
      .from("job_postings")
      .select("id")
      .eq("company_name", COMPANY_D);
    if (allError) throw allError;
    expect(all, "self-correction must update in place, never fork a second row").toHaveLength(1);
  });
});
