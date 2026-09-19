/**
 * send-388 — 6 of the 7 "Product" column links were plain strings, which
 * `MarketingFooter`'s own rendering (`const href = typeof link === "string"
 * ? "#" : link.href`) turns into dead `#` anchors. All 6 point at real,
 * shipped routes now (confirmed live: each 307-redirects a signed-out
 * visitor to `/login?redirectTo=...` rather than 404ing), so they moved into
 * the same `{ label, href }` object shape "Mentorship" already used.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingFooter } from "@/components/marketing/marketing-footer";

const PRODUCT_LINKS: Record<string, string> = {
  "Job Matching": "/jobs",
  "Resume Builder": "/resume-builder",
  "Resume Tailoring": "/tailor",
  "Job Tracker": "/tracker",
  Scholarships: "/scholarships",
  "Refer &amp; Earn": "/refer",
  Mentorship: "/mentorship",
};

describe("the footer's Product column", () => {
  const html = renderToStaticMarkup(<MarketingFooter />);

  it("renders a real href for every one of the 7 entries, never a dead '#' anchor", () => {
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
