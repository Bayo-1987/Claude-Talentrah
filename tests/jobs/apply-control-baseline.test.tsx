/**
 * What the Apply area looked like BEFORE "apply by email" (PR-E1), pinned on unchanged main so the change can be shown to leave it alone.
 *
 *   - the feed card is rendered, and the link-out (link only) and in-app Apply markup is compared byte for byte;
 *   - the job page is a 750-line async Server Component that no unit test can render, so its Apply branch is pinned as source, whitespace collapsed:
 *     the company-link anchor, the "Mark as applied" form, the branch order, and the signed-out "View on company site" gate (kept as is on purpose).
 *
 * The one thing this file does NOT pin is what main did with no link at all (`href="#"`): that dead button is the intended change.
 * Nothing here may be edited to make the change pass.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { JobCard } from "@/components/jobs/job-card";
import type { Tables } from "@/lib/supabase/types";

function card(over: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <JobCard
      job={{ id: "job-1", title: "Support Lead", company_name: "Acme", description: "A real posting.", location: "Lagos", work_type: null, seniority: null, external_url: "https://careers.acme.test/1", status: "open", source_type: "external", posted_at: "2026-11-01T00:00:00.000Z", last_checked_at: null, import_feed_id: null, ...over } as unknown as Tables<"job_postings">}
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

const MARK_APPLIED =
  '<button type="submit" class="text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust disabled:cursor-not-allowed disabled:opacity-50">Mark as applied</button></form>';
const LINK_CLASS =
  'class="inline-flex min-h-10 items-center justify-center border-none bg-ink px-[18px] py-[10px] font-body text-[13.5px] font-semibold text-paper no-underline transition-colors hover:bg-rust">Apply on company site</a>';

describe("the feed card, as main renders it", () => {
  it("link only: 'Mark as applied', then the company-site anchor, exactly", () => {
    const html = card({});
    expect(html).toContain(`${MARK_APPLIED}<a href="https://careers.acme.test/1" target="_blank" rel="noopener noreferrer" ${LINK_CLASS}`);
    expect(html).not.toContain("data-ad-click");
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("Apply by email");
  });
  it("link only, sponsored: the anchor carries data-ad-click, exactly", () => {
    const html = card({}, { isSponsored: true, campaignId: "c-1" });
    expect(html).toContain(`${MARK_APPLIED}<a href="https://careers.acme.test/1" target="_blank" rel="noopener noreferrer" data-ad-click="true" ${LINK_CLASS}`);
  });
  it("an imported posting (internal, import_feed_id set) renders the same link-out markup", () => {
    const html = card({ source_type: "internal", import_feed_id: "11111111-1111-4111-8111-111111111111" });
    expect(html).toContain(`${MARK_APPLIED}<a href="https://careers.acme.test/1" target="_blank" rel="noopener noreferrer" ${LINK_CLASS}`);
  });
  it("internal with a resume: the in-app Apply form button, exactly, and no company-site anchor", () => {
    const html = card({ source_type: "internal" });
    expect(html).toContain(
      '<button class="inline-flex items-center justify-center rounded-none font-body font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 bg-ink text-paper border-none min-h-[40px] px-[18px] py-[10px] text-[13.5px] hover:bg-rust" type="submit">Apply</button></form>',
    );
    expect(html).not.toContain("Apply on company site");
    expect(html).not.toContain("Apply by email");
  });
  it("internal without a resume: 'Add a resume to apply' to /resume-builder, exactly", () => {
    const html = card({ source_type: "internal" }, { hasBaseResume: false });
    expect(html).toContain(
      '<a class="inline-flex items-center justify-center rounded-none font-body font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 bg-ink text-paper border-none min-h-[40px] px-[18px] py-[10px] text-[13.5px] hover:bg-rust no-underline" href="/resume-builder">Add a resume to apply</a>',
    );
  });
});

describe("the job page's Apply branch, as main has it (source)", () => {
  const src = readFileSync(path.join(process.cwd(), "src/app/(app)/jobs/[id]/page.tsx"), "utf8").replace(/\s+/g, " ");

  it("the company-link anchor: new tab, noopener, primary button, 'Apply on company site'", () => {
    expect(src).toContain('target="_blank" rel="noopener noreferrer" className={buttonClasses("primary", "sm", "no-underline")} > Apply on company site </a>');
  });
  it("'Mark as applied' stays a form bound to markAppliedExternallyAction with the page's country state", () => {
    expect(src).toContain(
      '<form action={markAppliedExternallyAction.bind(null, job.id, detailCountryState)}> <button type="submit" className={buttonClasses("text", "sm")}> Mark as applied </button> </form>',
    );
  });
  it("branch order: already applied, then link-out, then no resume, then the in-app Apply", () => {
    const a = src.indexOf("alreadyApplied ? (");
    const b = src.indexOf(") : isExternal ? (", a);
    const c = src.indexOf(") : !hasBaseResume ? (", b);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(src).toContain("Add a resume to apply");
  });
  it("the signed-out view still offers 'Create a free account to apply' and 'View on company site' only for a posting with a link", () => {
    expect(src).toContain("Create a free account to apply");
    expect(src).toContain("{isExternal && job.external_url && ( <a href={job.external_url}");
    expect(src).toContain("View on company site");
  });
});
