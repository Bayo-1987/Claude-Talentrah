/**
 * schema.org/JobPosting ingestion — the fetcher itself (network mocked; the
 * end-to-end upsert/closure behaviour against the real database lives in
 * tests/jobs/ingest-schema-org.test.ts, same split as the rest of this
 * project's DB vs. non-DB tests).
 *
 * WHY THE SHAPE-VALIDATION TESTS EXIST. This fetcher is greenfield — there is
 * no earlier unguarded version of it to regression-test against, unlike most
 * fixes in this repo. `test-scenarios-external-api-integrations-prompt.md`
 * §1 already names `greenhouse.ts`/`lever.ts` as casting their API responses
 * with zero shape checking, throwing a raw TypeError on a contract change.
 * The `naiveMap` helper below reproduces that exact unguarded pattern inline
 * — not to test old code that doesn't exist here, but to prove the bug class
 * is real (it throws) before proving the guarded fetcher survives the same
 * input, the same "prove the test catches the bug first" standard this repo
 * holds every fix to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchSchemaOrgJobs } from "@/lib/jobs/sources/schema-org";

const REAL_FIXTURE: Record<string, unknown> = (() => {
  const raw = JSON.parse(
    readFileSync(join(__dirname, "fixtures/workable-job-posting.json"), "utf-8"),
  );
  delete raw._fixture_note;
  return raw;
})();

function htmlWithJsonLd(...blocks: unknown[]): string {
  const scripts = blocks
    .map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`)
    .join("\n");
  return `<!doctype html><html><head>${scripts}</head><body></body></html>`;
}

function itemList(urls: string[]) {
  return {
    "@context": "https://schema.org/",
    "@type": "ItemList",
    numberOfItems: urls.length,
    itemListElement: urls.map((url, i) => ({ "@type": "ListItem", position: i, url })),
  };
}

/** The pattern `greenhouse.ts`/`lever.ts` use today — cast straight through,
 * no shape check. Exists here only to demonstrate the failure mode the real
 * fetcher's `validateJobPosting` guards against. */
function naiveMap(node: Record<string, unknown>) {
  const org = node.hiringOrganization as { name: string };
  return { title: node.title as string, companyName: org.name };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockRoutes(routes: Record<string, string | { status: number }>) {
  fetchMock.mockImplementation(async (url: string) => {
    const route = routes[url];
    if (route === undefined) throw new Error(`unexpected fetch: ${url}`);
    if (typeof route === "object") {
      return { ok: false, status: route.status, text: async () => "" };
    }
    return { ok: true, status: 200, text: async () => route };
  });
}

describe("fetchSchemaOrgJobs", () => {
  it("maps a real captured JobPosting fixture to NormalizedJobPosting", async () => {
    const listingUrl = "https://jobs.workable.com/search/nigeria";
    const jobUrl = REAL_FIXTURE.url as string;

    mockRoutes({
      [listingUrl]: htmlWithJsonLd(itemList([jobUrl])),
      [jobUrl]: htmlWithJsonLd(REAL_FIXTURE),
    });

    const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "workable-nigeria");

    expect(skipped).toEqual([]);
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.title).toBe("Associate Product Manager");
    expect(job.companyName).toBe("Reliance Health");
    expect(job.externalSource).toBe("schema-org");
    expect(job.externalUrl).toBe(jobUrl);
    expect(job.postedAt).toBe("2026-02-18T15:37:35.838Z");
    expect(job.workType).toBe("remote"); // jobLocationType: TELECOMMUTE
    expect(job.employmentType).toBe("full_time"); // FULL_TIME
    expect(job.companyLogoUrl).toBe("https://workablehr.s3.amazonaws.com/uploads/account/logo/581188/logo");
    // real fingerprint, computed the same way every other source's is
    expect(job.dedupFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("a naive mapper throws on a JobPosting missing hiringOrganization — the bug class this fetcher guards against", () => {
    const malformed = { "@type": "JobPosting", title: "Ghost Role" };
    expect(() => naiveMap(malformed)).toThrow();
  });

  it("skips a JobPosting missing hiringOrganization, logs why, and still returns the other valid postings in the same batch", async () => {
    const listingUrl = "https://jobs.workable.com/search/nigeria";
    const goodUrl = "https://jobs.workable.com/view/good/finance-manager-at-good-co";
    const badUrl = "https://jobs.workable.com/view/bad/ghost-role-at-nobody";

    const goodPosting = {
      "@type": "JobPosting",
      title: "Finance Manager",
      datePosted: "2026-08-01T00:00:00.000Z",
      hiringOrganization: { "@type": "Organization", name: "Good Co" },
      jobLocationType: "TELECOMMUTE",
    };
    const badPosting = { "@type": "JobPosting", title: "Ghost Role" }; // no hiringOrganization, no location/remote flag

    mockRoutes({
      [listingUrl]: htmlWithJsonLd(itemList([goodUrl, badUrl])),
      [goodUrl]: htmlWithJsonLd(goodPosting),
      [badUrl]: htmlWithJsonLd(badPosting),
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "test-source");
    warnSpy.mockRestore();

    expect(jobs).toHaveLength(1);
    expect(jobs[0].companyName).toBe("Good Co");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].url).toBe(badUrl);
    expect(skipped[0].reason).toMatch(/hiringOrganization/);
  });

  it("a page with zero JobPosting blocks returns an empty array cleanly, not an error", async () => {
    const listingUrl = "https://jobs.workable.com/search/empty-country";
    // an ItemList with no items, and nothing else on the page — the
    // "empty/changed page" case from the brief
    mockRoutes({
      [listingUrl]: htmlWithJsonLd(itemList([])),
    });

    const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "test-source");
    expect(jobs).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("a page with no JSON-LD at all (not even an ItemList) returns an empty array cleanly", async () => {
    const listingUrl = "https://jobs.workable.com/search/broken";
    mockRoutes({ [listingUrl]: "<!doctype html><html><body>nothing here</body></html>" });

    const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "test-source");
    expect(jobs).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it("a single bad linked job page (fetch failure) is skipped, not fatal to the batch", async () => {
    const listingUrl = "https://jobs.workable.com/search/nigeria";
    const goodUrl = "https://jobs.workable.com/view/good/finance-manager-at-good-co";
    const brokenUrl = "https://jobs.workable.com/view/broken/500-at-somewhere";

    const goodPosting = {
      "@type": "JobPosting",
      title: "Finance Manager",
      hiringOrganization: { "@type": "Organization", name: "Good Co" },
      jobLocationType: "TELECOMMUTE",
    };

    mockRoutes({
      [listingUrl]: htmlWithJsonLd(itemList([goodUrl, brokenUrl])),
      [goodUrl]: htmlWithJsonLd(goodPosting),
      [brokenUrl]: { status: 500 },
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "test-source");
    warnSpy.mockRestore();

    expect(jobs).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].url).toBe(brokenUrl);
  });

  it("throws only when the top-level listing URL itself is unreachable — same failure mode as the Greenhouse/Lever fetchers", async () => {
    const listingUrl = "https://jobs.workable.com/search/gone";
    mockRoutes({ [listingUrl]: { status: 404 } });
    await expect(fetchSchemaOrgJobs(listingUrl, "test-source")).rejects.toThrow(/404/);
  });
});
