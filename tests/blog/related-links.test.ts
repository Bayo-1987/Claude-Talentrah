/**
 * send-486 — the "Continue on Talentrah" links under each blog post.
 *
 * The footer's Compare column was removed, which would have left /vs/jobright and /vs/jobcopilot
 * with no link from the rest of the site but each other. The comparison post
 * (`ai-job-search-tools-nigeria-africa`) is the natural home for them, so its list gains the two
 * /vs links AHEAD of the two it already had. A code change, not a database edit: the post's body is
 * untouched.
 *
 * This pins EVERY slug's list, not just the one that changed, so adding a link to one post cannot
 * quietly alter another (RELATED_LINKS is a hand-edited map; nothing else guards its content. The
 * signed-out link ratchet only asks whether each href is a gated page).
 *
 * No test in the repo renders a post's related section (CI's database has no such post; see
 * e2e/blog-comparison-redirect.spec.ts), so the rendered page is checked by a live probe after
 * deploy, recorded in handoff-status.md.
 */
import { describe, expect, it } from "vitest";
import { RELATED_LINKS, relatedLinksForPost } from "@/lib/blog/related-links";

const SCHOLARSHIP_CATALOG = [{ href: "/scholarships", label: "Browse the scholarship catalog" }];

/**
 * Every slug's list, as it must be. send-486 added the two /vs links to the comparison post; send-491 re-pointed
 * the four links that led a signed-out reader to /login (/tailor, /resume-builder, /tailor?coverLetter=1):
 * labels and order are unchanged, only the hrefs moved. Every other slug is exactly as it was.
 */
const EXPECTED: Record<string, { href: string; label: string }[]> = {
  "reading-your-match-score": [
    { href: "/jobs", label: "See your own Match Scores in the jobs feed" },
    { href: "/ai-resume-tailoring", label: "Tailor your resume to a specific job" },
  ],
  "beating-the-ats": [
    { href: "/ai-resume-tailoring", label: "Tailor your resume with Farah" },
    { href: "/ai-resume-builder", label: "Build a resume from an ATS-safe template" },
  ],
  "when-to-bring-in-a-mentor": [{ href: "/mentorship", label: "Browse mentors on Talentrah" }],
  "cover-letters-that-dont-sound-like-a-template": [
    { href: "/signup?redirectTo=%2Ftailor%3FcoverLetter%3D1", label: "Write your cover letter with Farah" },
  ],
  "gates-cambridge-scholarship-2027": SCHOLARSHIP_CATALOG,
  "mastercard-foundation-scholars-program": SCHOLARSHIP_CATALOG,
  "rhodes-scholarship-west-africa": SCHOLARSHIP_CATALOG,
  "chevening-scholarships-2027": SCHOLARSHIP_CATALOG,
  "trudeau-foundation-doctoral-scholarship": SCHOLARSHIP_CATALOG,
  "ptdf-overseas-scholarship-nigeria": SCHOLARSHIP_CATALOG,
  "ai-job-search-tools-nigeria-africa": [
    { href: "/vs/jobright", label: "Talentrah vs Jobright, side by side" },
    { href: "/vs/jobcopilot", label: "Talentrah vs FreshTalent JobCopilot, side by side" },
    { href: "/ai-resume-tailoring", label: "Try the AI resume tailoring" },
    { href: "/mentorship", label: "Browse mentors on Talentrah" },
  ],
};

describe("blog related links (send-486)", () => {
  it("the comparison post returns exactly the four links, the two /vs links first, the original two after them in their old order", () => {
    expect(relatedLinksForPost("ai-job-search-tools-nigeria-africa")).toEqual([
      { href: "/vs/jobright", label: "Talentrah vs Jobright, side by side" },
      { href: "/vs/jobcopilot", label: "Talentrah vs FreshTalent JobCopilot, side by side" },
      { href: "/ai-resume-tailoring", label: "Try the AI resume tailoring" },
      { href: "/mentorship", label: "Browse mentors on Talentrah" },
    ]);
  });

  it("every other slug's list is unchanged (all pinned)", () => {
    const others = Object.keys(EXPECTED).filter((slug) => slug !== "ai-job-search-tools-nigeria-africa");
    expect(others.length).toBe(10);
    for (const slug of others) {
      expect(relatedLinksForPost(slug), slug).toEqual(EXPECTED[slug]);
    }
  });

  it("the map has exactly these slugs: none added or dropped by accident", () => {
    expect(Object.keys(RELATED_LINKS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("an unmapped slug still gets no section rather than a guess", () => {
    expect(relatedLinksForPost("a-post-nobody-has-mapped")).toEqual([]);
  });
});
