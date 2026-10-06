/** The badge as markup (VERIFY-1 Phase 0a): the line, the "What this means" disclosure and the link, openable by keyboard, and no score anywhere. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ResumeReviewedBadge } from "@/components/talent-directory/resume-reviewed-badge";

const html = (props: Parameters<typeof ResumeReviewedBadge>[0]) => renderToStaticMarkup(<ResumeReviewedBadge {...props} />).replace(/&#x27;/g, "'");

describe("the badge line", () => {
  it("says who reviewed it and when", () => {
    expect(html({ method: "ai", reviewedAt: "2026-10-05T09:30:00Z" })).toContain("Resume reviewed by Farah (AI) · 5 Oct 2026");
    expect(html({ method: "mentor", reviewedAt: "2026-10-12T22:30:00Z" })).toContain("Resume reviewed by a Talentrah mentor · 12 Oct 2026");
  });

  it("says who reviewed it, with no date, when none is given", () => {
    const out = html({ method: "mentor" });
    expect(out).toContain("Resume reviewed by a Talentrah mentor");
    expect(out).not.toContain("·");
  });

  it("is named for tests and never says 'verified' or shows a score", () => {
    const out = html({ method: "ai", reviewedAt: "2026-10-05T09:30:00Z" });
    expect(out).toContain('data-testid="resume-reviewed-badge"');
    expect(out).not.toMatch(/verified|\/100/i);
  });
});

describe("'What this means'", () => {
  const out = html({ method: "ai", reviewedAt: "2026-10-05T09:30:00Z" });

  it("opens from the badge: a native disclosure (keyboard and screen reader work, no script)", () => {
    expect(out).toMatch(/<details[^>]*>\s*<summary[^>]*>What this means<\/summary>/);
  });

  it("says what was and was not checked, in the owner's words", () => {
    expect(out).toContain("We checked that the resume is complete, specific and consistent. We did not check identity, employment history or skills.");
  });

  it("links to the page that explains it", () => {
    expect(out).toMatch(/<a [^>]*href="\/how-we-review-resumes"[^>]*>How we review<\/a>/);
  });

  it("is closed to begin with", () => {
    expect(out).not.toMatch(/<details[^>]*\sopen/);
  });

  it("has a visible focus style on the control", () => {
    expect(out).toContain("focus-visible:outline");
  });
});
