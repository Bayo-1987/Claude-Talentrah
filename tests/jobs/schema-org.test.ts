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
    // Qualified with the source label so two schema.org sources occupy
    // different namespaces in external_source — see types.ts and
    // tests/jobs/ingest-schema-org-multi-source.test.ts.
    expect(job.externalSource).toBe("schema-org:workable-nigeria");
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

  /**
   * validThrough / baseSalary — the two Search Console findings this file's
   * ingestion side was missing (the third, employmentType, was already
   * mapped and needed no code change; see docs/ci-and-tooling-gaps.md).
   *
   * Same "malformed field costs that one field, not the listing" contract as
   * the rest of this file: a required field (title, hiringOrganization,
   * location-or-remote) skips the whole posting, but validThrough and
   * baseSalary are optional and best-effort, so garbage in either one is
   * silently dropped and the posting still comes back as a `job`, never a
   * `skipped`.
   */
  describe("validThrough → expiresAt", () => {
    function withValidThrough(validThrough: unknown) {
      return {
        "@type": "JobPosting",
        title: "Backend Engineer",
        hiringOrganization: { "@type": "Organization", name: "Good Co" },
        jobLocationType: "TELECOMMUTE",
        validThrough,
      };
    }

    it("carries a real ISO date through as expiresAt", async () => {
      const listingUrl = "https://jobs.workable.com/search/nigeria";
      mockRoutes({ [listingUrl]: htmlWithJsonLd(withValidThrough("2099-12-31T00:00:00.000Z")) });

      const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(skipped).toEqual([]);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].expiresAt).toBe("2099-12-31T00:00:00.000Z");
    });

    it("accepts a non-ISO but real-world date format", async () => {
      const listingUrl = "https://jobs.workable.com/search/nigeria";
      mockRoutes({ [listingUrl]: htmlWithJsonLd(withValidThrough("December 31, 2099")) });

      const { jobs } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(jobs[0].expiresAt).toBeDefined();
      expect(new Date(jobs[0].expiresAt!).getUTCFullYear()).toBe(2099);
    });

    it("MALFORMED DATE: omits expiresAt, but still returns the posting as a job, not a skip", async () => {
      const listingUrl = "https://jobs.workable.com/search/nigeria";
      mockRoutes({ [listingUrl]: htmlWithJsonLd(withValidThrough("whenever, probably")) });

      const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(skipped, "a malformed validThrough must not invalidate the listing").toEqual([]);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].expiresAt, "an unparsable date must not be guessed at or coerced").toBeUndefined();
    });

    it("MALFORMED SHAPE: a non-string validThrough is omitted the same way", async () => {
      const listingUrl = "https://jobs.workable.com/search/nigeria";
      mockRoutes({ [listingUrl]: htmlWithJsonLd(withValidThrough({ nonsense: true })) });

      const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(skipped).toEqual([]);
      expect(jobs[0].expiresAt).toBeUndefined();
    });

    it("no validThrough at all is the ordinary case — no crash, no field", async () => {
      const listingUrl = "https://jobs.workable.com/search/nigeria";
      mockRoutes({
        [listingUrl]: htmlWithJsonLd({
          "@type": "JobPosting",
          title: "Backend Engineer",
          hiringOrganization: { "@type": "Organization", name: "Good Co" },
          jobLocationType: "TELECOMMUTE",
        }),
      });

      const { jobs } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(jobs[0].expiresAt).toBeUndefined();
    });
  });

  describe("baseSalary → salaryMin/salaryMax/salaryCurrency/salaryUnit", () => {
    function withBaseSalary(baseSalary: unknown) {
      return {
        "@type": "JobPosting",
        title: "Backend Engineer",
        hiringOrganization: { "@type": "Organization", name: "Good Co" },
        jobLocationType: "TELECOMMUTE",
        baseSalary,
      };
    }

    it("a MonetaryAmount/QuantitativeValue range maps to min/max/currency/unit", async () => {
      const listingUrl = "https://jobs.workable.com/search/nigeria";
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(
          withBaseSalary({
            "@type": "MonetaryAmount",
            currency: "ngn",
            value: { "@type": "QuantitativeValue", minValue: 500000, maxValue: 800000, unitText: "MONTH" },
          }),
        ),
      });

      const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(skipped).toEqual([]);
      expect(jobs[0].salaryMin).toBe(500000);
      expect(jobs[0].salaryMax).toBe(800000);
      // Uppercased regardless of how the source cased it.
      expect(jobs[0].salaryCurrency).toBe("NGN");
      expect(jobs[0].salaryUnit).toBe("month");
    });

    it("a single stated figure (bare value, no min/max) becomes an equal min and max", async () => {
      const listingUrl = "https://jobs.workable.com/search/nigeria";
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(
          withBaseSalary({
            "@type": "MonetaryAmount",
            currency: "USD",
            value: { "@type": "QuantitativeValue", value: 90000, unitText: "YEAR" },
          }),
        ),
      });

      const { jobs } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(jobs[0].salaryMin).toBe(90000);
      expect(jobs[0].salaryMax).toBe(90000);
      expect(jobs[0].salaryUnit).toBe("year");
    });

    it("a bare number as `value` (no nested QuantitativeValue) is also accepted", async () => {
      const listingUrl = "https://jobs.workable.com/search/nigeria";
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(withBaseSalary({ "@type": "MonetaryAmount", currency: "USD", value: 120000 })),
      });

      const { jobs } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(jobs[0].salaryMin).toBe(120000);
      expect(jobs[0].salaryMax).toBe(120000);
      expect(jobs[0].salaryUnit).toBeUndefined();
    });

    it("MALFORMED: no currency at all — never fabricate one, so the whole salary is omitted", async () => {
      const listingUrl = "https://jobs.workable.com/search/nigeria";
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(
          withBaseSalary({
            "@type": "MonetaryAmount",
            value: { "@type": "QuantitativeValue", minValue: 500000, maxValue: 800000 },
          }),
        ),
      });

      const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(skipped, "a malformed baseSalary must not invalidate the listing").toEqual([]);
      expect(jobs[0].salaryMin).toBeUndefined();
      expect(jobs[0].salaryMax).toBeUndefined();
      expect(jobs[0].salaryCurrency).toBeUndefined();
    });

    it("MALFORMED: a currency that isn't a 3-letter code is rejected, not passed through", async () => {
      const listingUrl = "https://jobs.workable.com/search/nigeria";
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(
          withBaseSalary({
            "@type": "MonetaryAmount",
            currency: "US Dollars",
            value: { "@type": "QuantitativeValue", value: 90000 },
          }),
        ),
      });

      const { jobs } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(jobs[0].salaryCurrency).toBeUndefined();
      expect(jobs[0].salaryMin).toBeUndefined();
    });

    it("MALFORMED: an inverted range (max < min) is omitted rather than swapped or half-kept", async () => {
      const listingUrl = "https://jobs.workable.com/search/nigeria";
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(
          withBaseSalary({
            "@type": "MonetaryAmount",
            currency: "NGN",
            value: { "@type": "QuantitativeValue", minValue: 800000, maxValue: 500000 },
          }),
        ),
      });

      const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(skipped).toEqual([]);
      expect(jobs[0].salaryMin).toBeUndefined();
      expect(jobs[0].salaryMax).toBeUndefined();
    });

    it("MALFORMED: baseSalary is a plain string — no crash, salary just isn't there", async () => {
      const listingUrl = "https://jobs.workable.com/search/nigeria";
      mockRoutes({ [listingUrl]: htmlWithJsonLd(withBaseSalary("competitive")) });

      const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(skipped).toEqual([]);
      expect(jobs[0].salaryMin).toBeUndefined();
    });

    it("no baseSalary at all is the ordinary case — no crash, no field", async () => {
      const listingUrl = "https://jobs.workable.com/search/nigeria";
      mockRoutes({
        [listingUrl]: htmlWithJsonLd({
          "@type": "JobPosting",
          title: "Backend Engineer",
          hiringOrganization: { "@type": "Organization", name: "Good Co" },
          jobLocationType: "TELECOMMUTE",
        }),
      });

      const { jobs } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(jobs[0].salaryMin).toBeUndefined();
      expect(jobs[0].salaryCurrency).toBeUndefined();
    });
  });

  /**
   * workType — schema.org has no "hybrid" value, so hybrid is inferred from
   * the one signal Workable actually emits: TELECOMMUTE *plus* a real
   * physical address. Before this, every TELECOMMUTE posting was mapped to
   * `remote` regardless, which is not merely a wrong badge — the feed filters
   * on "country OR remote", so `remote` is a passport onto every country's
   * board. Verified in production at the time of the fix: of 72 open
   * schema-org postings stored as `remote`, exactly the 28 carrying a
   * physical address were the 28 whose Workable slug begins `hybrid-`.
   */
  describe("workType — TELECOMMUTE plus a physical address means hybrid, not remote", () => {
    const listingUrl = "https://jobs.workable.com/search/nigeria";

    function posting(extra: Record<string, unknown>) {
      return {
        "@type": "JobPosting",
        title: "Backend Engineer",
        hiringOrganization: { "@type": "Organization", name: "Good Co" },
        ...extra,
      };
    }

    /** The real shape behind the Clickatell rows the production audit found:
     * TELECOMMUTE kept alongside a fully populated Cape Town address. */
    it("TELECOMMUTE + a real address → hybrid (and keeps the physical location string)", async () => {
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(
          posting({
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
          }),
        ),
      });

      const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(skipped).toEqual([]);
      expect(jobs[0].workType).toBe("hybrid");
      // The location and the work type now agree — the contradiction that
      // made this a bug was a row reading "Remote" while naming a city.
      expect(jobs[0].location).toBe("Cape Town, Western Cape, South Africa");
    });

    it("TELECOMMUTE + no jobLocation at all → remote", async () => {
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(posting({ jobLocationType: "TELECOMMUTE" })),
      });

      const { jobs } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(jobs[0].workType).toBe("remote");
      expect(jobs[0].location).toBe("Remote");
    });

    /** Workable's real fully-remote shape (see the captured fixture at the
     * top of this file): a `Place` node is present but carries no address,
     * so "is there a jobLocation object" is NOT the usable test — the shared
     * `usableAddressParts` helper is. */
    it("TELECOMMUTE + an empty Place with no address → remote, not hybrid", async () => {
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(
          posting({ jobLocationType: "TELECOMMUTE", jobLocation: { "@type": "Place" } }),
        ),
      });

      const { jobs } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(jobs[0].workType).toBe("remote");
    });

    it("TELECOMMUTE + an address object whose every field is empty → remote", async () => {
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(
          posting({
            jobLocationType: "TELECOMMUTE",
            jobLocation: { "@type": "Place", address: { "@type": "PostalAddress" } },
          }),
        ),
      });

      const { jobs } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(jobs[0].workType).toBe("remote");
    });

    /**
     * Was "→ undefined, unchanged behaviour" — schema.org has no explicit
     * "onsite" value, so a real address with no TELECOMMUTE signal used to
     * fall all the way through to undefined, indistinguishable from a
     * posting this parser simply failed to read. That collapsed two very
     * different things onto the same NULL: measured on production, this was
     * 65% of the whole board. A physical address IS positive evidence of an
     * on-site role, so it is asserted now instead of discarded — see
     * mapWorkType's own header for why this is not the same move as
     * defaulting on missing signal.
     */
    it("a real address with NO TELECOMMUTE → onsite", async () => {
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(
          posting({
            jobLocation: {
              "@type": "Place",
              address: {
                "@type": "PostalAddress",
                addressLocality: "Lagos",
                addressRegion: "Lagos",
                addressCountry: "Nigeria",
              },
            },
          }),
        ),
      });

      const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(skipped).toEqual([]);
      expect(jobs[0].workType).toBe("onsite");
      expect(jobs[0].location).toBe("Lagos, Lagos, Nigeria");
    });

    /**
     * The other side of the same rule: no TELECOMMUTE and no address either
     * (only the `applicantLocationRequirements` remote-ish flag, which is
     * what lets this posting past validateJobPosting at all — see the
     * TELECOMMUTE+applicantLocationRequirements+no-address case below for
     * why that flag alone was never sufficient evidence of remote). With
     * nothing naming an actual place, this must stay undefined — the whole
     * point of the onsite branch is that it is evidence-gated, not a second
     * default sitting next to the first one.
     */
    it("no TELECOMMUTE and no address at all → still undefined, not onsite by default", async () => {
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(
          posting({ applicantLocationRequirements: { "@type": "Country", name: "Nigeria" } }),
        ),
      });

      const { jobs, skipped } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(skipped).toEqual([]);
      expect(jobs[0].workType).toBeUndefined();
      expect(jobs[0].location).toBeUndefined();
    });

    /**
     * THE TRAP THIS PINS. `applicantLocationRequirements` is the other
     * remote-ish flag this schema exposes, and validateJobPosting accepts it
     * as proof a location-less posting is real. It is deliberately NOT a
     * third work-type rule: a posting carrying it AND a physical address is
     * still hybrid. Keying on it would reintroduce exactly the bug being
     * fixed, just through a different field.
     */
    it("TELECOMMUTE + address + applicantLocationRequirements → still hybrid", async () => {
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(
          posting({
            jobLocationType: "TELECOMMUTE",
            applicantLocationRequirements: { "@type": "Country", name: "Nigeria" },
            jobLocation: {
              "@type": "Place",
              address: {
                "@type": "PostalAddress",
                addressLocality: "Lagos",
                addressRegion: "Lagos",
                addressCountry: "Nigeria",
              },
            },
          }),
        ),
      });

      const { jobs } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(jobs[0].workType).toBe("hybrid");
    });

    /** The mirror of the case above, and the shape of the real captured
     * fixture: the same flag with NO address still means remote. Together
     * these two prove the address is the only signal that decides it. */
    it("TELECOMMUTE + applicantLocationRequirements + no address → remote", async () => {
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(
          posting({
            jobLocationType: "TELECOMMUTE",
            applicantLocationRequirements: { "@type": "Country", name: "Nigeria" },
          }),
        ),
      });

      const { jobs } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(jobs[0].workType).toBe("remote");
    });

    /** A partial address is still a real place — one populated field is
     * enough, matching what formatLocation has always treated as usable. */
    it("TELECOMMUTE + a country-only address → hybrid", async () => {
      mockRoutes({
        [listingUrl]: htmlWithJsonLd(
          posting({
            jobLocationType: "TELECOMMUTE",
            jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressCountry: "Kenya" } },
          }),
        ),
      });

      const { jobs } = await fetchSchemaOrgJobs(listingUrl, "test-source");
      expect(jobs[0].workType).toBe("hybrid");
      expect(jobs[0].location).toBe("Kenya");
    });
  });
});
