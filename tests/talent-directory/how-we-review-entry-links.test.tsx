/**
 * HWR-1: every entry link to the How we review page carries `from`, as a path from the allow-list, and no entry link is the bare path any more.
 *
 * The badge is a component, so it is rendered; the pages and the applicant list render only after data, so their source is checked (the e2e spec drives them for real).
 * Both halves of each rule are asserted, so "always" and "never" fail alike.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResumeReviewedBadge } from "@/components/talent-directory/resume-reviewed-badge";

const read = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8").replace(/\s+/g, " ");

describe("the badge's 'How we review' link", () => {
  const Badge = ResumeReviewedBadge as (p: { method: "ai" | "mentor" | "unknown"; reviewedAt?: string | null; from?: string }) => ReturnType<typeof ResumeReviewedBadge>;
  const html = (from?: string) => renderToStaticMarkup(<>{Badge({ method: "ai", reviewedAt: "2026-10-05T10:00:00Z", from })}</>);

  it.each(["/employer/talent-directory", "/employer/jobs", "/talent-directory/verify"])("from %s: the link carries it, encoded", (from) => {
    expect(html(from)).toContain(`href="/how-we-review-resumes?from=${encodeURIComponent(from)}"`);
  });
  it("with no `from`, or one that is not allowed, it is the plain page (no query)", () => {
    expect(html()).toContain('href="/how-we-review-resumes"');
    expect(html("//evil.example")).toContain('href="/how-we-review-resumes"');
    expect(html("/employer/talent-directory/123e4567-e89b-12d3-a456-426614174000")).toContain('href="/how-we-review-resumes"');
  });
});

describe("each place that links to the page passes where the person is", () => {
  it("the employer directory list: its own link and every card's badge", () => {
    const s = read("src/app/employer/talent-directory/page.tsx");
    expect(s).toMatch(/href=\{howWeReviewHref\("\/employer\/talent-directory"\)\}/);
    expect(s).toMatch(/<ResumeReviewedBadge [^>]*from="\/employer\/talent-directory"/);
    expect(s).not.toMatch(/href=\{HOW_WE_REVIEW_PATH\}/);
  });
  it("a candidate's page: the badge links back to the list, with no candidate id in the path", () => {
    const s = read("src/app/employer/talent-directory/[candidateId]/page.tsx");
    expect(s).toMatch(/<ResumeReviewedBadge [^>]*from="\/employer\/talent-directory"/);
    expect(s).not.toMatch(/from=\{/);
  });
  it("the applicant list: the badge links back to Jobs Posted, with no job id in the path", () => {
    const s = read("src/components/employer/applicant-list.tsx");
    expect(s).toMatch(/<ResumeReviewedBadge [^>]*from="\/employer\/jobs"/);
    expect(s).not.toMatch(/from=\{/);
  });
  it("the seeker's resume-review page", () => {
    const s = read("src/app/(app)/talent-directory/verify/page.tsx");
    expect(s).toMatch(/href=\{howWeReviewHref\("\/talent-directory\/verify"\)\}/);
    expect(s).not.toMatch(/href=\{HOW_WE_REVIEW_PATH\}/);
  });
  it("nothing builds the query by hand: only howWeReviewHref writes `?from=`", () => {
    for (const f of ["src/app/employer/talent-directory/page.tsx", "src/app/employer/talent-directory/[candidateId]/page.tsx", "src/components/employer/applicant-list.tsx", "src/app/(app)/talent-directory/verify/page.tsx", "src/components/talent-directory/resume-reviewed-badge.tsx"]) {
      expect(read(f), f).not.toMatch(/\?from=/);
    }
  });
});
