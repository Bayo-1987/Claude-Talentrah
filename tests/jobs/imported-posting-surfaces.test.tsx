/**
 * Employer job import, PR 2: every surface a seeker sees treats an IMPORTED posting (import_feed_id set, stored `internal`) as LINK-OUT, and labels it "Posted on {Company}'s own site"
 * (not "sourced externally", which is the aggregated-listing wording, and not "Posted on Talentrah", which would claim an in-app application).
 *
 *   - isLinkOutPosting / provenanceLabel / queueSourceType: the shared decisions, pure.
 *   - the feed card: "Apply on company site" and "Mark as applied", never the in-app Apply; the label; no applicant count.
 *   - the signed-out landing row: the label, never "Posted on Talentrah".
 *   - the structured data: directApply is false.
 * The ordinary internal and external postings are unchanged (the regression half of each case).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "@/components/jobs/job-card";
import { JobsPublicLanding } from "@/components/jobs/public-landing";
import { buildJobPostingJsonLd } from "@/lib/seo/job-posting-jsonld";
import { postingAgeLine } from "@/lib/jobs/freshness";
import { isImportedPosting, isLinkOutPosting, provenanceLabel, queueSourceType } from "@/lib/jobs/link-out";
import type { Tables } from "@/lib/supabase/types";

const FEED = "11111111-1111-4111-8111-111111111111";
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

describe("the shared decisions", () => {
  it.each([
    [{ source_type: "internal" }, false],
    [{ source_type: "internal", import_feed_id: null }, false],
    [{ source_type: "external" }, true],
    [{ source_type: "external", import_feed_id: null }, true],
    [{ source_type: "internal", import_feed_id: FEED }, true],
  ])("isLinkOutPosting(%j) is %s", (job, expected) => {
    expect(isLinkOutPosting(job)).toBe(expected);
    expect(queueSourceType(job)).toBe(expected ? "external" : "internal");
  });
  it("isImportedPosting is true only for a feed marker", () => {
    expect(isImportedPosting({ import_feed_id: FEED })).toBe(true);
    expect(isImportedPosting({ import_feed_id: null })).toBe(false);
    expect(isImportedPosting({})).toBe(false);
  });
  it("provenanceLabel: external -> sourced externally; imported -> Posted on {Company}'s own site; internal -> null", () => {
    expect(provenanceLabel({ source_type: "external", company_name: "Acme" })).toBe("sourced externally");
    expect(provenanceLabel({ source_type: "internal", import_feed_id: FEED, company_name: "Acme" })).toBe("Posted on Acme's own site");
    expect(provenanceLabel({ source_type: "internal", company_name: "Acme" })).toBeNull();
  });
});

function card(over: Record<string, unknown>) {
  return renderToStaticMarkup(
    <JobCard
      job={{ id: "job-1", title: "Support Lead", company_name: "Acme", description: "A real posting.", location: "Lagos", work_type: null, seniority: null, external_url: "https://careers.acme.test/1", status: "open", source_type: "internal", posted_at: daysAgo(2), last_checked_at: null, import_feed_id: null, ...over } as unknown as Tables<"job_postings">}
      score={75}
      isSaved={false}
      applicationStage={null}
      explanation={{ matchedSkills: [], missingSkills: [], seniorityAlignment: "unknown" }}
      origin="https://talentrah.test"
      countryState="none"
      hasBaseResume={true}
      applicantCount={null}
    />,
  );
}

describe("the feed card", () => {
  const imported = card({ import_feed_id: FEED });
  it("an imported posting applies on the company's site: the link, 'Mark as applied', no in-app Apply", () => {
    expect(imported).toContain("Apply on company site");
    expect(imported).toContain('href="https://careers.acme.test/1"');
    expect(imported).not.toMatch(/>Apply<|Apply in Talentrah|Easy Apply/);
  });
  it("is labelled 'Posted on Acme's own site' and not 'sourced externally'", () => {
    expect(imported.replace(/&#x27;/g, "'")).toContain("Posted on Acme's own site");
    expect(imported).not.toContain("sourced externally");
    expect(imported).not.toContain("Posted on Talentrah");
  });
  it("an ordinary internal posting still gets the in-app Apply and no provenance label; an external one still says 'sourced externally'", () => {
    const own = card({});
    expect(own).not.toContain("Apply on company site");
    expect(own).not.toContain("own site");
    const external = card({ source_type: "external", last_checked_at: daysAgo(0) });
    expect(external).toContain("sourced externally");
    expect(external).toContain("Apply on company site");
  });
});

describe("the signed-out landing row", () => {
  const row = (over: Record<string, unknown>) => ({ id: "00000000-0000-4000-8000-000000000001", title: "Support Lead", company_name: "Acme", location: "Lagos, Nigeria", work_type: "remote" as const, source_type: "internal" as const, import_feed_id: null as string | null, posted_at: daysAgo(1), ...over });
  const render = (jobs: ReturnType<typeof row>[]) => renderToStaticMarkup(<JobsPublicLanding total={50} jobs={jobs as never} facets={[]} />).replace(/&#x27;/g, "'");
  it("an imported posting says it was posted on the company's own site, never 'Posted on Talentrah'", () => {
    const html = render([row({ import_feed_id: FEED })]);
    expect(html).toContain("Posted on Acme's own site");
    expect(html).not.toContain("Posted on Talentrah</span>");
  });
  it("internal and external rows keep their wording", () => {
    expect(render([row({})])).toContain("Posted on Talentrah");
    expect(render([row({ source_type: "external" })])).toContain("sourced externally");
  });
});

describe("structured data", () => {
  const job = (over: Record<string, unknown>) => ({
    id: "job-1", organization_id: "org-1", title: "Support Lead", company_name: "Acme", description: "<p>Do support work for customers across Nigeria.</p>", location: "Lagos, Nigeria", work_type: "onsite", employment_type: "full_time", status: "open",
    source_type: "internal", external_url: "https://careers.acme.test/1", posted_at: daysAgo(2), expires_at: null, import_feed_id: null, organizations: { name: "Acme", website: null, logo_url: null }, ...over,
  });
  it("directApply is false for an imported posting, true for an ordinary internal one, false for an external one", () => {
    const build = (over: Record<string, unknown>) => buildJobPostingJsonLd(job(over) as never) as { directApply?: boolean } | null;
    expect(build({ import_feed_id: FEED })?.directApply).toBe(false);
    expect(build({})?.directApply).toBe(true);
    expect(build({ source_type: "external", organization_id: null })?.directApply).toBe(false);
  });
});

describe("the age line", () => {
  const now = Date.now();
  const line = (over: Record<string, unknown>) => postingAgeLine({ source_type: "internal", posted_at: daysAgo(3), last_checked_at: daysAgo(0), ...over } as never, now);
  it("an imported posting shows 're-verified' (the daily sync re-reads the employer's page); an ordinary internal one does not", () => {
    expect(line({ import_feed_id: FEED })).toContain("re-verified");
    expect(line({})).not.toContain("re-verified");
  });
  it("an external posting still shows it, and a never-checked imported posting does not", () => {
    expect(line({ source_type: "external" })).toContain("re-verified");
    expect(line({ import_feed_id: FEED, last_checked_at: null })).not.toContain("re-verified");
  });
});
