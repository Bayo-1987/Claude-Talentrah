/**
 * Two schema.org sources must not close each other's postings.
 *
 * THE BUG THIS WAS WRITTEN AGAINST. `ingest.ts`'s freshness sweep scoped a
 * schema-org source's closure to `external_source = 'schema-org'` — the bare
 * discriminator, identical for every schema-org config — with no
 * per-source qualifier:
 *
 *     .eq("external_source", config.source)   // "schema-org" for ALL of them
 *     .eq("status", "open");
 *     if (config.source !== "schema-org") {
 *       closeQuery = closeQuery.eq("company_name", config.companyName);
 *     }
 *
 * greenhouse/lever get a second predicate (`company_name`) that scopes them to
 * their own board. schema-org got nothing. So with two configured sources, A's
 * run closes every one of B's rows — B's fingerprints aren't in A's seen list
 * — and then B's run closes A's. The feed loses half its external postings on
 * every ingest, and which half depends on config order.
 *
 * Not reachable with the single source shipped today, which is exactly why it
 * needed a test rather than a comment: it becomes reachable the moment someone
 * acts on `sources.config.ts`'s own invitation to add another source, and it
 * fails silently — postings just quietly stop appearing.
 *
 * PROVEN TO CATCH IT. Against the pre-fix code this file fails with
 * "CROSS-SOURCE CLOSURE: source B closed 2 of source A's postings" and both of
 * A's rows read `status: 'closed'`.
 *
 * Network is mocked; Supabase is not — the closure sweep is a database
 * behaviour, so mocking it would assert nothing. Same split as
 * tests/jobs/ingest-schema-org.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`multi-source ingest test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { A, B } = vi.hoisted(() => {
  const runId = Math.random().toString(36).slice(2, 10);
  return {
    A: {
      label: `multi-a-${runId}`,
      listing: `https://a.workable.test/${runId}/search`,
      job: `https://a.workable.test/${runId}/view/1`,
      job2: `https://a.workable.test/${runId}/view/2`,
      company: `Multi Src A ${runId}`,
    },
    B: {
      label: `multi-b-${runId}`,
      listing: `https://b.workable.test/${runId}/search`,
      job: `https://b.workable.test/${runId}/view/1`,
      company: `Multi Src B ${runId}`,
    },
  };
});

vi.mock("@/lib/jobs/sources.config", () => ({
  JOB_SOURCES: [
    { source: "schema-org", url: A.listing, label: A.label },
    { source: "schema-org", url: B.listing, label: B.label },
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

const jobPosting = (company: string, title: string) => ({
  "@type": "JobPosting",
  title,
  datePosted: new Date().toISOString(),
  hiringOrganization: { "@type": "Organization", name: company },
  jobLocationType: "TELECOMMUTE",
});

/** Routes both listings; anything else (Supabase) goes to the real fetch. */
function mockRoutes(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: unknown) => {
      const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
      if (url in routes) {
        return { ok: true, status: 200, text: async () => htmlWithJsonLd(routes[url]) };
      }
      if (url.includes(".workable.test/")) throw new Error(`unstubbed test URL: ${url}`);
      return realFetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
    }),
  );
}

async function statusesByCompany(): Promise<Record<string, string[]>> {
  const { data, error } = await admin
    .from("job_postings")
    .select("company_name, title, status")
    .in("company_name", [A.company, B.company]);
  if (error) throw error;
  const out: Record<string, string[]> = { [A.company]: [], [B.company]: [] };
  for (const r of data ?? []) out[r.company_name]?.push(r.status);
  return out;
}

async function cleanup() {
  await admin.from("job_postings").delete().in("company_name", [A.company, B.company]);
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

describe("two schema-org sources in one ingest run", () => {
  it("each source's closure sweep touches only its own rows", async () => {
    const { ingestAllSources } = await import("@/lib/jobs/ingest");

    // Both listings full: A has two postings, B has one.
    mockRoutes({
      [A.listing]: itemList([A.job, A.job2]),
      [A.job]: jobPosting(A.company, "A Role One"),
      [A.job2]: jobPosting(A.company, "A Role Two"),
      [B.listing]: itemList([B.job]),
      [B.job]: jobPosting(B.company, "B Role One"),
    });

    const first = await ingestAllSources();
    for (const r of first) {
      expect(r.error, `ingest reported an error: ${r.error}`).toBeUndefined();
    }

    const afterFirst = await statusesByCompany();
    expect(afterFirst[A.company], "source A should have inserted two postings").toHaveLength(2);
    expect(afterFirst[B.company], "source B should have inserted one posting").toHaveLength(1);

    /*
     * The assertion that fails against the unfixed code. Both sources are
     * still fully populated, so nothing should close. Pre-fix, B's sweep
     * matched A's rows (same bare `external_source`, A's fingerprints absent
     * from B's seen list) and closed them — and A's sweep closed B's.
     */
    const closedA = afterFirst[A.company].filter((s) => s === "closed").length;
    const closedB = afterFirst[B.company].filter((s) => s === "closed").length;

    expect(
      closedA,
      `CROSS-SOURCE CLOSURE: source B closed ${closedA} of source A's postings while A's listing still carried them`,
    ).toBe(0);
    expect(
      closedB,
      `CROSS-SOURCE CLOSURE: source A closed ${closedB} of source B's postings while B's listing still carried them`,
    ).toBe(0);
  });

  it("a source still closes its OWN posting that drops off its listing", async () => {
    // Positive control. Scoping per-source must not disable closure itself —
    // an assertion of "nothing ever closes" would be satisfied by a broken
    // sweep that matches no rows at all.
    mockRoutes({
      [A.listing]: itemList([A.job]), // A Role Two is gone
      [A.job]: jobPosting(A.company, "A Role One"),
      [B.listing]: itemList([B.job]),
      [B.job]: jobPosting(B.company, "B Role One"),
    });

    await ingestAndAssertNoErrors();

    const { data, error } = await admin
      .from("job_postings")
      .select("title, status")
      .in("company_name", [A.company, B.company]);
    if (error) throw error;

    const byTitle = Object.fromEntries((data ?? []).map((r) => [r.title, r.status]));
    expect(byTitle["A Role One"], "A's still-listed posting must stay open").toBe("open");
    expect(byTitle["A Role Two"], "A's delisted posting must close").toBe("closed");
    expect(byTitle["B Role One"], "B's posting is unaffected by A's turnover").toBe("open");
  });
});

async function ingestAndAssertNoErrors() {
  const { ingestAllSources } = await import("@/lib/jobs/ingest");
  const results = await ingestAllSources();
  for (const r of results) expect(r.error, `ingest reported an error: ${r.error}`).toBeUndefined();
  return results;
}
