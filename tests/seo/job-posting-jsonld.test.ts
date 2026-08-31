/**
 * JobPosting structured data.
 *
 * ── WHY THIS IS TESTED HARD ───────────────────────────────────────────────
 *
 * Structured data fails silently. A missing required property does not break
 * the page, does not throw, and does not show up anywhere a person looks — it
 * shows up weeks later as "we are not in Google for Jobs", or as errors in a
 * Search Console nobody has open. There is no runtime signal at all, so the
 * tests are the signal.
 *
 * The required/recommended split is Google's, read from its JobPosting
 * documentation rather than recalled:
 *
 *   REQUIRED     title, description, datePosted, hiringOrganization,
 *                jobLocation — unless the role is TELECOMMUTE, which needs
 *                applicantLocationRequirements instead
 *   RECOMMENDED  employmentType, validThrough, identifier, directApply
 *
 * ── THE BUG THESE WERE WRITTEN AFTER ──────────────────────────────────────
 *
 * The first version of the parser treated "Remote, Nigeria" as a city with no
 * country and produced nothing for it. That is the single most common shape in
 * the live `location` column: it silently dropped 58 of 155 postings, a third
 * of the board, with no error anywhere. Hence the location cases below being
 * taken verbatim from production rather than invented.
 */
import { describe, expect, it } from "vitest";
import { buildJobPostingJsonLd, parseJobLocation } from "@/lib/seo/job-posting-jsonld";
import type { Tables } from "@/lib/supabase/types";

type Job = Tables<"job_postings">;

const base = (over: Partial<Job> = {}): Job =>
  ({
    id: "11111111-1111-1111-1111-111111111111",
    title: "Backend Engineer",
    company_name: "Zaria Digital",
    description: "Build and maintain the payment services. Node.js, TypeScript, PostgreSQL.",
    location: "Lagos, Nigeria",
    posted_at: "2026-08-20T09:00:00.000Z",
    expires_at: null,
    employment_type: "full_time",
    work_type: null,
    source_type: "internal",
    company_logo_url: null,
    status: "open",
    structured_jd: {},
    ...over,
  }) as unknown as Job;

describe("locations, taken verbatim from the live column", () => {
  it.each([
    ["Lagos, Nigeria", { places: 1, remoteCountries: 0, remote: false }],
    ["Remote, Nigeria", { places: 0, remoteCountries: 1, remote: true }],
    ["Remote, Lagos, Nigeria", { places: 1, remoteCountries: 1, remote: true }],
    ["London, United Kingdom; Remote, Nigeria", { places: 1, remoteCountries: 1, remote: true }],
    ["Remote, India; Remote, Nigeria; Remote, Spain", { places: 0, remoteCountries: 3, remote: true }],
  ])("%s", (raw, want) => {
    const p = parseJobLocation(raw);
    expect(p.places).toHaveLength(want.places);
    expect(p.remoteCountries).toHaveLength(want.remoteCountries);
    expect(p.remote).toBe(want.remote);
  });

  it("does NOT drop 'Remote, <country>' — the bug that cost a third of the board", () => {
    const p = parseJobLocation("Remote, Nigeria");
    expect(p.remoteCountries, "a remote entry's country was treated as a city").toEqual(["Nigeria"]);
  });

  it("refuses to guess a country it was not given", () => {
    // A bare "Lagos" is a real value. Assuming Nigeria would be inventing a
    // fact about someone else's job ad; addressCountry is mandatory, so this
    // posting gets no markup instead.
    const p = parseJobLocation("Lagos");
    expect(p.places).toHaveLength(0);
    expect(p.unresolved).toBe(true);
  });
});

describe("Google's required set is present or nothing is emitted", () => {
  it("emits every required property for an ordinary posting", () => {
    const ld = buildJobPostingJsonLd(base())!;
    expect(ld).not.toBeNull();
    for (const key of ["title", "description", "datePosted", "hiringOrganization", "jobLocation"]) {
      expect(ld, `missing required property ${key}`).toHaveProperty(key);
    }
    expect(ld["@type"]).toBe("JobPosting");
    expect(ld.datePosted).toBe("2026-08-20T09:00:00.000Z");
  });

  it("uses TELECOMMUTE plus applicantLocationRequirements for a remote role", () => {
    const ld = buildJobPostingJsonLd(base({ location: "Remote, Nigeria", work_type: "remote" }))!;
    expect(ld.jobLocationType).toBe("TELECOMMUTE");
    expect(ld.applicantLocationRequirements).toEqual([{ "@type": "Country", name: "Nigeria" }]);
  });

  it("returns null rather than invalid markup when no country is knowable", () => {
    // Invalid structured data is worse than none: absent means "not eligible",
    // invalid means an error in Search Console on a page that looks fine.
    expect(buildJobPostingJsonLd(base({ location: "Remote", work_type: "remote" }))).toBeNull();
    expect(buildJobPostingJsonLd(base({ location: "Lagos" }))).toBeNull();
    expect(buildJobPostingJsonLd(base({ location: null }))).toBeNull();
  });

  it("returns null when description is missing or merely repeats the title", () => {
    // Google rejects a description identical to the title.
    expect(buildJobPostingJsonLd(base({ description: "" }))).toBeNull();
    expect(buildJobPostingJsonLd(base({ description: "Backend Engineer" }))).toBeNull();
  });
});

describe("the recommended properties, and the ones deliberately withheld", () => {
  it("maps employmentType to Google's case-sensitive vocabulary", () => {
    expect(buildJobPostingJsonLd(base())!.employmentType).toBe("FULL_TIME");
    expect(buildJobPostingJsonLd(base({ employment_type: "contract" }))!.employmentType).toBe(
      "CONTRACTOR",
    );
  });

  it("omits employmentType rather than guessing at an unmapped value", () => {
    expect(buildJobPostingJsonLd(base({ employment_type: null }))).not.toHaveProperty(
      "employmentType",
    );
  });

  it("omits validThrough when the posting has no expiry", () => {
    // All 155 live postings have expires_at null: 0053 added the column with
    // no default on purpose. Google says omit rather than invent one.
    expect(buildJobPostingJsonLd(base())).not.toHaveProperty("validThrough");
  });

  it("emits validThrough as soon as a source supplies one", () => {
    const ld = buildJobPostingJsonLd(base({ expires_at: "2026-12-01T00:00:00.000Z" }))!;
    expect(ld.validThrough).toBe("2026-12-01T00:00:00.000Z");
  });

  it("claims directApply only for postings we actually accept applications for", () => {
    // External postings are handed off to the source site, never submitted
    // here — claiming a direct flow would be untrue and Google checks it.
    expect(buildJobPostingJsonLd(base({ source_type: "internal" }))!.directApply).toBe(true);
    expect(buildJobPostingJsonLd(base({ source_type: "external" }))!.directApply).toBe(false);
  });
});
