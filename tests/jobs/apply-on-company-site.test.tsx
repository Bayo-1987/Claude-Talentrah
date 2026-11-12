/**
 * PR-E4 gate 2, the seeker side of "On our career site": an INTERNAL posting whose apply_link_kind is set offers "Apply on company site" as a plain anchor to /jobs/{id}/go (never to the stored address),
 * with NO visible caption (the host is in the button's accessible name only), and none of the in-app controls. The stored address is never in the HTML. Rows whose links come from imports (external_url) keep today's raw-href behaviour exactly.
 * The "Apply by email" card control (apply-by-email-card.tsx, UX-QUICK) and the sponsored-click attribute are not touched by it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "@/components/jobs/job-card";
import { ApplyOnCompanySite } from "@/components/jobs/apply-on-company-site";
import type { Tables } from "@/lib/supabase/types";

const JOB = "11111111-1111-4111-8111-111111111111";
const STORED = "https://careers.acme.test/secret-path/apply?id=42";

function card(over: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const job = { id: JOB, title: "Support Lead", company_name: "Acme", description: "A real posting.", location: "Lagos", work_type: null, seniority: null, external_url: null, status: "open", source_type: "internal", organization_id: "org-1", posted_at: "2026-11-01T00:00:00.000Z", last_checked_at: null, import_feed_id: null, ...over };
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
/** What a person can read: text nodes only, so attribute values (the aria-label, the href) are not part of it. */
const visibleText = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const anchors = (html: string) => [...html.matchAll(/<a [^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);

describe("ApplyOnCompanySite", () => {
  it("is a plain anchor to the redirect route with the new-tab attributes and an accessible name that carries the host and says it opens a new tab; no caption is printed", () => {
    for (const variant of ["page", "card"] as const) {
      const html = renderToStaticMarkup(<ApplyOnCompanySite jobId={JOB} host="careers.acme.test" variant={variant} />);
      const a = anchors(html).find((x) => x.includes("Apply on company site"))!;
      expect(a, variant).toContain(`href="/jobs/${JOB}/go"`);
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noopener noreferrer nofollow"');
      expect(a).toContain('aria-label="Apply on company site, opens careers.acme.test in a new tab"');
      expect(a).toMatch(/aria-label="[^"]*careers\.acme\.test[^"]*"/);
      // The visible text is the button text and nothing else: no "Opens", no host.
      expect(visibleText(html)).toBe("Apply on company site");
      expect(visibleText(html)).not.toMatch(/\bOpens\b/i);
      expect(visibleText(html)).not.toContain("careers.acme.test");
      expect(html).not.toMatch(/https?:\/\//);
    }
  });
  it("a sponsored card keeps the delegated click attribute on the anchor; an ordinary one has none", () => {
    expect(renderToStaticMarkup(<ApplyOnCompanySite jobId={JOB} host="x.example" variant="card" sponsored />)).toContain('data-ad-click="true"');
    expect(renderToStaticMarkup(<ApplyOnCompanySite jobId={JOB} host="x.example" variant="card" />)).not.toContain("data-ad-click");
  });
  it("refuses to render without a job id or a host (nothing half-built reaches a page)", () => {
    expect(renderToStaticMarkup(<ApplyOnCompanySite jobId="" host="x.example" variant="page" />)).toBe("");
    expect(renderToStaticMarkup(<ApplyOnCompanySite jobId={JOB} host="" variant="page" />)).toBe("");
  });
});

describe("the feed card", () => {
  it("an internal job with a career-site link shows 'Apply on company site' to /go and 'Mark as applied' with no caption, host only in the aria-label, and none of the in-app or email controls", () => {
    const html = card({ apply_link_kind: "company", apply_link_host: "careers.acme.test" });
    expect(html).toContain(`href="/jobs/${JOB}/go"`);
    expect(html).toContain('aria-label="Apply on company site, opens careers.acme.test in a new tab"');
    expect(visibleText(html)).not.toMatch(/\bOpens\b/i);
    expect(visibleText(html)).not.toContain("careers.acme.test");
    expect(html).toContain("Mark as applied");
    expect(html).not.toMatch(/<button[^>]*>\s*Apply\s*<\/button>|Apply by email|mailto:|Add a resume to apply/);
  });
  it("the stored address is never in the HTML, even when the row object carries it", () => {
    const html = card({ apply_link: STORED, apply_link_kind: "company", apply_link_host: "careers.acme.test" });
    expect(html).not.toContain(STORED);
    expect(html).not.toContain("secret-path");
    expect(html).not.toContain("careers.acme.test/");
    expect(html).not.toMatch(/https?:\/\/careers/);
  });
  it("still offered when the seeker has no base resume (there is no resume check)", () => {
    const html = card({ apply_link_kind: "ats", apply_link_host: "boards.greenhouse.io" }, { hasBaseResume: false });
    expect(html).toContain(`href="/jobs/${JOB}/go"`);
    expect(html).not.toContain("Add a resume to apply");
  });
  it("a sponsored card carries data-ad-click on the new anchor", () => {
    expect(card({ apply_link_kind: "company", apply_link_host: "x.example" }, { isSponsored: true, campaignId: "c-1" })).toMatch(/<a [^>]*data-ad-click="true"[^>]*>Apply on company site<\/a>/);
  });
  it("a row with a kind but no host is not offered the control (nothing to say it opens), and the ordinary Apply stays", () => {
    const html = card({ apply_link_kind: "company", apply_link_host: null });
    expect(html).not.toContain("/go");
  });
  it("A2: a row whose link comes from an import (external_url, no kind) keeps today's raw anchor exactly, and never goes through /go", () => {
    const html = card({ source_type: "external", organization_id: null, external_url: "https://careers.acme.test/jobs/1", apply_link_kind: null, apply_link_host: null });
    expect(html).toContain('href="https://careers.acme.test/jobs/1"');
    expect(html).toContain("Apply on company site");
    expect(html).not.toContain("/go");
    expect(html).toMatch(/<a [^>]*rel="noopener noreferrer"[^>]*>/);
  });
  it("an internal job with no link and no address is the ordinary in-app Apply, unchanged", () => {
    const html = card({});
    expect(html).toMatch(/<button[^>]*>\s*Apply\s*<\/button>/);
    expect(html).not.toContain("/go");
  });
  it("the Apply-by-email card control is unchanged next to it: an email job still renders the mailto anchor and no /go", () => {
    const html = card({ apply_email: "careers@example.test" });
    expect(html).toContain("mailto:careers@example.test");
    expect(html).not.toContain("/go");
  });
});

describe("the job page's wiring (source)", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/(app)/jobs/[id]/page.tsx"), "utf8").replace(/\s+/g, " ");
  const start = src.indexOf(") : internalApplyLink ? (");
  const branch = src.slice(start, src.indexOf(") : !hasBaseResume ? (", start));
  it("has its own branch after the email one and before the no-resume and in-app branches", () => {
    expect(start).toBeGreaterThan(src.indexOf(") : internalApplyEmail ? ("));
    expect(src.indexOf(") : !hasBaseResume ? (")).toBeGreaterThan(start);
  });
  it("the link is read as a kind and a host only, through the shared helper", () => {
    expect(src).toContain("const internalApplyLink = isExternal ? null : postingApplyLinkHost(job);");
  });
  it("offers 'Apply on company site' to the redirect, 'Mark as applied' and a note, and none of the in-app controls", () => {
    expect(branch).toContain('<ApplyOnCompanySite jobId={job.id} host={internalApplyLink} variant="page" />');
    expect(branch).toContain("Mark as applied");
    expect(branch).not.toMatch(/applyInAppAction|applyWithScreeningAction|ScreeningForm|Add a resume to apply|external_url/);
  });
  it("shows a plain message when the redirect could not be followed, instead of a bare 404", () => {
    expect(src).toContain('searchParams: Promise<{ applyLink?: string }>');
    expect(src).toContain('applyLink === "recheck-failed"');
    expect(src).toContain("That company's careers link isn't available right now.");
  });
});
