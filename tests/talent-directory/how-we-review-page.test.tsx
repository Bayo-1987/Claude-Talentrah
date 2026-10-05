/**
 * The public "How we review resumes" page (VERIFY-1 Phase 0a): it renders signed out, says what is and is not checked in plain words, has no figures and no
 * "verified", and is linked from the badge and from the employer directory.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isProtectedSeekerPath } from "@/lib/auth/seeker-gate-paths";
import { HOW_WE_REVIEW_PATH } from "@/lib/talent-directory/review-badge";

vi.mock("@/components/marketing/marketing-masthead", () => ({ MarketingMasthead: () => <header data-testid="masthead" /> }));
vi.mock("@/components/marketing/marketing-footer", () => ({ MarketingFooter: () => <footer data-testid="footer" /> }));

const { default: Page, metadata } = await import("@/app/how-we-review-resumes/page");
const html = renderToStaticMarkup(<Page />).replace(/&#x27;/g, "'").replace(/&rsquo;|’/g, "'");
const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the page", () => {
  it("is where the badge points, and is public (not behind the signed-in gate)", () => {
    expect(HOW_WE_REVIEW_PATH).toBe("/how-we-review-resumes");
    expect(isProtectedSeekerPath(HOW_WE_REVIEW_PATH)).toBe(false);
    expect(metadata.alternates?.canonical ?? "").toContain("/how-we-review-resumes");
  });

  it("has a heading, and says what is checked and what is not, each under its own heading", () => {
    expect(html).toContain("How we review resumes");
    expect(html).toContain("What is checked");
    expect(html).toContain("What is not checked");
    for (const word of ["Complete:", "Specific:", "Consistent:"]) expect(plain).toContain(word);
  });

  it("says plainly that identity, employment and skills were not checked", () => {
    expect(plain).toContain("We did not check who the person is.");
    expect(plain).toContain("did not contact past employers");
    expect(plain).toContain("We did not test their skills.");
  });

  it("names both reviewers as the badge does, and says the score is not shown to employers", () => {
    expect(plain).toContain("Resume reviewed by Farah (AI).");
    expect(plain).toContain("Resume reviewed by a Talentrah mentor.");
    expect(plain).toContain("Employers do not see it.");
    expect(plain).toContain("A mentor review has no score.");
  });

  it("says the review is of the resume on that date, not a recommendation or a ranking", () => {
    expect(plain).toContain("It is not a ranking and it is not a recommendation of the person.");
    expect(plain).toContain("a resume that has changed since has not been reviewed again");
  });

  it("has no figures at all (no statistics, no percentages, no counts), and never says 'verified'", () => {
    expect(plain).not.toMatch(/\d/);
    expect(plain).not.toMatch(/verified/i);
  });

  it("makes no promise about checks that do not exist yet", () => {
    expect(plain).not.toMatch(/\b(will|soon|coming|plan to|in future|going to)\b/i);
  });
});
