/**
 * S12 (g) — JobPosting JSON-LD for a location that is a single token.
 *
 * Measured on production (2026-10-01, 661 open, markup-eligible postings): 142 produced no markup because the location
 * was a bare "Remote" (62) or one token with no country (80). This pins what may become eligible and what must not:
 *   - a single token that is an exact ISO country name (or one explicit alias) is a COUNTRY: on-site -> addressCountry
 *     only; remote -> TELECOMMUTE + applicantLocationRequirements Country;
 *   - "Georgia" and "Jersey" never resolve from free text;
 *   - "Remote, Bangalore" must not claim a country called "Bangalore" (it did: the old positional rule took any token
 *     after "Remote," as a country);
 *   - a bare "Remote" still emits nothing, and nothing is ever "Worldwide".
 */
import { describe, expect, it } from "vitest";
import { buildJobPostingJsonLd, parseJobLocation } from "@/lib/seo/job-posting-jsonld";
import type { Tables } from "@/lib/supabase/types";

type Job = Tables<"job_postings">;
const job = (over: Partial<Job> = {}): Job =>
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
    source_type: "external",
    company_logo_url: null,
    status: "open",
    structured_jd: {},
    ...over,
  }) as unknown as Job;

const addr = (ld: Record<string, unknown>) =>
  (ld.jobLocation as Array<{ address: Record<string, unknown> }>).map((p) => p.address);

describe("an on-site posting whose whole location is a country", () => {
  it("'Ghana' -> jobLocation with addressCountry only, and no remote markup", () => {
    const ld = buildJobPostingJsonLd(job({ location: "Ghana", work_type: "onsite" }))!;
    expect(ld).not.toBeNull();
    expect(addr(ld)).toEqual([{ "@type": "PostalAddress", addressCountry: "Ghana" }]);
    expect(ld).not.toHaveProperty("jobLocationType");
    expect(ld).not.toHaveProperty("applicantLocationRequirements");
  });

  it.each([
    ["UK", "United Kingdom"],
    ["USA", "United States"],
    ["UAE", "United Arab Emirates"],
    ["Cameroon (CM)", "Cameroon"],
  ])("%s -> addressCountry %s", (raw, country) => {
    const ld = buildJobPostingJsonLd(job({ location: raw, work_type: "onsite" }))!;
    expect(addr(ld)).toEqual([{ "@type": "PostalAddress", addressCountry: country }]);
  });
});

describe("a remote posting whose whole location is a country", () => {
  it("'Nigeria' + remote -> TELECOMMUTE and applicantLocationRequirements Country Nigeria", () => {
    const ld = buildJobPostingJsonLd(job({ location: "Nigeria", work_type: "remote" }))!;
    expect(ld).not.toBeNull();
    expect(ld.jobLocationType).toBe("TELECOMMUTE");
    expect(ld.applicantLocationRequirements).toEqual([{ "@type": "Country", name: "Nigeria" }]);
  });

  it("'Remote, South Africa; Remote, Kenya' -> two applicant countries, nothing invented", () => {
    const ld = buildJobPostingJsonLd(job({ location: "Remote, South Africa; Remote, Kenya", work_type: "remote" }))!;
    expect(ld.applicantLocationRequirements).toEqual([
      { "@type": "Country", name: "South Africa" },
      { "@type": "Country", name: "Kenya" },
    ]);
  });
});

describe("what must not be guessed", () => {
  it.each(["Georgia", "Jersey"])("'%s' alone is unresolved, for on-site and for remote", (raw) => {
    expect(parseJobLocation(raw).unresolved).toBe(true);
    expect(parseJobLocation(raw).places).toEqual([]);
    expect(buildJobPostingJsonLd(job({ location: raw, work_type: "onsite" }))).toBeNull();
    expect(buildJobPostingJsonLd(job({ location: raw, work_type: "remote" }))).toBeNull();
  });

  it("'Tbilisi, Georgia' still reads Georgia as the country: two tokens, so the positional rule applies (unchanged)", () => {
    expect(parseJobLocation("Tbilisi, Georgia").places).toEqual([{ country: "Georgia", locality: "Tbilisi" }]);
  });

  it("'Remote, Bangalore' does not claim a country called Bangalore", () => {
    const p = parseJobLocation("Remote, Bangalore");
    expect(p.remoteCountries).toEqual([]);
    expect(p.remote).toBe(true);
    expect(p.unresolved).toBe(true);
    expect(buildJobPostingJsonLd(job({ location: "Remote, Bangalore", work_type: "remote" }))).toBeNull();
  });

  it("'Remote, EMEA' and 'Remote - Germany and Switzerland' are not countries either", () => {
    expect(parseJobLocation("Remote, EMEA").remoteCountries).toEqual([]);
    expect(parseJobLocation("Remote - Germany and Switzerland").remoteCountries).toEqual([]);
  });

  it("a bare 'Remote' still emits nothing, and no posting is ever claimed worldwide", () => {
    expect(buildJobPostingJsonLd(job({ location: "Remote", work_type: "remote" }))).toBeNull();
    for (const loc of ["Remote", "Ghana", "Nigeria", "Remote, Kenya", "Lagos, Nigeria"]) {
      const ld = buildJobPostingJsonLd(job({ location: loc, work_type: "remote" }));
      expect(JSON.stringify(ld ?? {})).not.toMatch(/worldwide|anywhere|global/i);
    }
  });

  it("the multi-token positional rule and the 'Remote, <country>' shapes already in production are unchanged", () => {
    expect(parseJobLocation("Remote, Nigeria").remoteCountries).toEqual(["Nigeria"]);
    expect(parseJobLocation("Remote, Poland").remoteCountries).toEqual(["Poland"]);
    expect(parseJobLocation("Remote, South Africa").remoteCountries).toEqual(["South Africa"]);
    expect(parseJobLocation("Remote, Lagos, Nigeria").places).toEqual([{ country: "Nigeria", locality: "Lagos" }]);
    expect(parseJobLocation("Lagos, Lagos, Nigeria").places).toEqual([{ country: "Nigeria", locality: "Lagos" }]);
  });
});
