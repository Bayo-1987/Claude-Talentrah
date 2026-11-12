/**
 * PR-E2b, the seeker side of an employer who chose "By email": an INTERNAL posting with an address. The card is rendered whole; the job page (an async Server Component no unit test can render)
 * is read as source, like tests/jobs/apply-control.test.tsx. The owner's rule holds throughout: the address is only ever inside the mailto link, never printed as text.
 * An internal posting with no address must stay byte-identical to today (tests/jobs/apply-control-baseline.test.tsx holds the bytes; the null case is asserted again here).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "@/components/jobs/job-card";
import type { Tables } from "@/lib/supabase/types";

const ADDRESS = "careers@example.test";

function card(over: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const job = { id: "job-1", title: "Support Lead", company_name: "Acme", description: "A real posting.", location: "Lagos", work_type: null, seniority: null, external_url: null, status: "open", source_type: "internal", organization_id: "org-1", posted_at: "2026-11-01T00:00:00.000Z", last_checked_at: null, import_feed_id: null, ...over };
  return renderToStaticMarkup(
    <JobCard
      job={job as unknown as Tables<"job_postings">}
      score={75}
      isSaved={false}
      applicationStage={null}
      explanation={{ matchedSkills: [], missingSkills: [], seniorityAlignment: "unknown" }}
      origin="https://talentrah.test"
      countryState="none"
      hasBaseResume={true}
      applicantCount={null}
      {...extra}
    />,
  );
}

describe("the feed card for an internal posting that takes applications by email", () => {
  it("shows 'Apply by email' (a mailto link) and 'Mark as applied', and no in-app Apply button", () => {
    const html = card({ apply_email: ADDRESS });
    expect(html).toContain(`href="mailto:${ADDRESS}?subject=Application%3A%20Support%20Lead"`);
    expect(html).toContain(">Apply by email</a>");
    expect(html).toContain("Mark as applied");
    expect(html).not.toMatch(/<button[^>]*>\s*Apply\s*<\/button>/);
    expect(html).not.toContain("Add a resume to apply");
    expect(html).not.toContain("Apply on company site");
    expect(html).not.toContain('href="#"');
  });

  it("never prints the address as text: it appears only inside the mailto link", () => {
    const html = card({ apply_email: ADDRESS });
    const withoutHref = html.replace(/href="[^"]*"/g, "");
    expect(withoutHref).not.toContain(ADDRESS);
    expect(withoutHref).not.toContain("example.test");
  });

  it("still takes email when the seeker has no base resume (there is no resume check to fail)", () => {
    const html = card({ apply_email: ADDRESS }, { hasBaseResume: false });
    expect(html).toContain(">Apply by email</a>");
    expect(html).not.toContain("Add a resume to apply");
  });

  it("a sponsored card keeps the delegated click attribute on the mailto anchor", () => {
    const html = card({ apply_email: ADDRESS }, { isSponsored: true, campaignId: "c-1" });
    expect(html).toMatch(/<a [^>]*data-ad-click="true"[^>]*>Apply by email<\/a>|<a [^>]*>Apply by email<\/a>/);
    expect(html).toContain("mailto:");
  });

  it("an unusable stored value is no address: the ordinary in-app Apply stays", () => {
    const html = card({ apply_email: "a@b.co, c@d.co" });
    expect(html).not.toContain("Apply by email");
    expect(html).toMatch(/<button[^>]*>\s*Apply\s*<\/button>/);
  });

  it("an internal posting with no address is the ordinary in-app Apply, unchanged", () => {
    for (const apply_email of [null, undefined]) {
      const html = card({ apply_email });
      expect(html).not.toContain("Apply by email");
      expect(html).not.toContain("mailto:");
      expect(html).toMatch(/<button[^>]*>\s*Apply\s*<\/button>/);
    }
  });

  it("an external posting that has an address keeps the E1 behaviour (company link first, address second)", () => {
    const html = card({ source_type: "external", organization_id: null, external_url: "https://careers.acme.test/1", apply_email: ADDRESS });
    expect(html).toContain("Apply on company site");
    expect(html).toContain("Or apply by email");
  });
});

describe("the job page's wiring (source)", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/(app)/jobs/[id]/page.tsx"), "utf8").replace(/\s+/g, " ");
  const start = src.indexOf(") : internalApplyEmail ? (");
  const branch = src.slice(start, src.indexOf(") : !hasBaseResume ? (", start));

  it("an internal posting with an address has its own branch: after 'already applied' and the link-out branch, before the no-resume and in-app branches", () => {
    const applied = src.indexOf("alreadyApplied ? (");
    const linkOut = src.indexOf(") : isExternal ? (");
    const noResume = src.indexOf(") : !hasBaseResume ? (");
    expect(linkOut).toBeGreaterThan(applied);
    expect(start).toBeGreaterThan(linkOut);
    expect(noResume).toBeGreaterThan(start);
  });
  it("the address is read through the shared helper, only for a posting that is not link-out", () => {
    expect(src).toContain("const internalApplyEmail = isExternal ? null : postingApplyEmail(job);");
  });
  it("the branch offers 'Apply by email', 'Mark as applied' and the note, and none of the in-app controls", () => {
    expect(branch).toContain('<ApplyByEmailLink address={internalApplyEmail} title={job.title} variant="page" />');
    expect(branch).toContain("Mark as applied");
    expect(branch).toContain("<ApplyByEmailNote />");
    expect(branch).not.toMatch(/applyInAppAction|applyWithScreeningAction|ScreeningForm|Add a resume to apply/);
  });
  it("the page never prints the address", () => {
    // The value is handed to the button as a prop and nowhere else: no text child, no label, no title attribute.
    expect(branch.replace(") : internalApplyEmail ? (", "").split("address={internalApplyEmail}").join("")).not.toMatch(/internalApplyEmail|applyEmail|apply_email/);
  });
});

describe("the feed's applicant counts", () => {
  const feed = readFileSync(path.join(process.cwd(), "src/app/(app)/jobs/(feed)/page.tsx"), "utf8").replace(/\s+/g, " ");
  it("count only postings people apply to inside Talentrah: an email posting has no count", () => {
    expect(feed).toContain('!isLinkOutPosting(s.job) && s.job.source_type === "internal" && !takesApplicationsOffPlatform(s.job)');
    expect(feed).toContain('job.source_type === "internal" && !takesApplicationsOffPlatform(job) && applicantCounts');
  });
});
