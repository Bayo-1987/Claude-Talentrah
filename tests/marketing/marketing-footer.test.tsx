/**
 * send-388 — 6 of the (then) 7 "Product" column links were plain strings,
 * which `MarketingFooter`'s own rendering (`const href = typeof link ===
 * "string" ? "#" : link.href`) turns into dead `#` anchors. All 6 point at
 * real, shipped routes now (confirmed live: each 307-redirects a signed-out
 * visitor to `/login?redirectTo=...` rather than 404ing), so they moved into
 * the same `{ label, href }` object shape "Mentorship" already used.
 *
 * send-403 — merged alongside send-386 (SEO landing pages) and send-387
 * Part 2 (Auto-Apply explainer), both landing in the same PR batch and both
 * adding their own Product entries. "Resume Tailoring" specifically has two
 * independently-reasoned answers here (send-388's own `/tailor` vs. send-386's
 * `/ai-resume-tailoring`) — resolved in send-386's favour, since that page
 * carries this feature's own SEO copy/metadata and has its own CTA into
 * /tailor, making it the better landing spot for a footer visitor. This
 * file's own fixture reflects the actual final 9-entry column, not the
 * 7-entry snapshot this test was originally written against.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

const PRODUCT_LINKS: Record<string, string> = {
  "Job Matching": "/jobs",
  "Resume Builder": "/resume-builder",
  "Resume Tailoring": "/ai-resume-tailoring",
  "ATS Resume Checker": "/ats-resume-checker",
  "Job Tracker": "/tracker",
  Scholarships: "/scholarships",
  "Refer &amp; Earn": "/refer",
  Mentorship: "/mentorship",
  "Auto-Apply": "/how-auto-apply-works",
};

describe("the footer's Product column", () => {
  const html = renderToStaticMarkup(<MarketingFooter />);

  it("renders a real href for every one of the 9 entries, never a dead '#' anchor", () => {
    for (const [label, href] of Object.entries(PRODUCT_LINKS)) {
      const anchor = new RegExp(`<a href="${href}"[^>]*>${label}<`);
      expect(html, `${label} did not link to ${href}`).toMatch(anchor);
    }
  });

  it("contains no bare '#' anchor left over from the old plain-string entries", () => {
    // A real other-column link (Privacy Policy) is used as a control so this
    // assertion can't pass just because the footer has zero anchors at all.
    expect(html).toContain('href="/legal/privacy"');
    expect(html).not.toMatch(/href="#"/);
  });
});
