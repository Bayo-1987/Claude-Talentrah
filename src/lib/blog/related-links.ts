/**
 * Per-post internal links to the actual Talentrah feature each post is
 * about — the SEO audit's own finding: the posts currently read as fairly
 * standalone, with no path from "convinced by the advice" to "using the
 * thing." A reader who finishes "Beating the ATS" and wants to act on it
 * should not have to go find the tailoring flow themselves.
 *
 * A STATIC, PER-SLUG MAP RATHER THAN REUSING `relevantJobLandingLinks` OR
 * HAND-ROLLING A SECOND LIVE-CHECKED SELECTOR. That helper (src/lib/seo/
 * landing-page-links.ts) answers a different question — which job/
 * scholarship LISTING pages currently have enough live entries to be worth
 * linking to — and exists because that answer changes as postings
 * open/close. A blog post pointing at a stable app feature (/tailor,
 * /resume-builder, /mentorship, /scholarships) is not that kind of link: none
 * of these routes can "run out of entries" the way a city or country jobs
 * page can, so there is nothing here for a live check to protect against.
 * Duplicating that machinery for a fixed 10-row map would be exactly the
 * kind of premature abstraction CLAUDE.md warns against.
 *
 * Scholarship-deadline posts (the six published 2026-09-17) all point at the
 * same catalog rather than getting individual entries — the internal-linking
 * gap the audit found was "posts read as standalone", not "each scholarship
 * post needs a bespoke link".
 */

export interface RelatedLink {
  href: string;
  label: string;
}

const SCHOLARSHIP_CATALOG: RelatedLink = { href: "/scholarships", label: "Browse the scholarship catalog" };

const RELATED_LINKS: Record<string, RelatedLink[]> = {
  "reading-your-match-score": [
    { href: "/jobs", label: "See your own Match Scores in the jobs feed" },
    { href: "/tailor", label: "Tailor your resume to a specific job" },
  ],
  "beating-the-ats": [
    { href: "/tailor", label: "Tailor your resume with Farah" },
    { href: "/resume-builder", label: "Build a resume from an ATS-safe template" },
  ],
  "when-to-bring-in-a-mentor": [{ href: "/mentorship", label: "Browse mentors on Talentrah" }],
  "cover-letters-that-dont-sound-like-a-template": [
    { href: "/tailor?coverLetter=1", label: "Write your cover letter with Farah" },
  ],
  "gates-cambridge-scholarship-2027": [SCHOLARSHIP_CATALOG],
  "mastercard-foundation-scholars-program": [SCHOLARSHIP_CATALOG],
  "rhodes-scholarship-west-africa": [SCHOLARSHIP_CATALOG],
  "chevening-scholarships-2027": [SCHOLARSHIP_CATALOG],
  "trudeau-foundation-doctoral-scholarship": [SCHOLARSHIP_CATALOG],
  "ptdf-overseas-scholarship-nigeria": [SCHOLARSHIP_CATALOG],
};

/** Every entry above is a fixed app route, never empty. Unknown slugs (a
 * future post nobody has mapped yet) get no section rather than a guess. */
export function relatedLinksForPost(slug: string): RelatedLink[] {
  return RELATED_LINKS[slug] ?? [];
}
