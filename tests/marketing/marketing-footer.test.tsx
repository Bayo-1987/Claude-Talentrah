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
 *
 * send-461 — a new "Compare" column (Jobright Alternative, vs. JobCopilot)
 * pinned the same way, so a future edit can't silently turn either into a
 * dead `#` anchor the way the original Product entries used to be.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { isProtectedSeekerPath } from "@/lib/auth/seeker-gate-paths";
import robots from "@/app/robots";

const PRODUCT_LINKS: Record<string, string> = {
  "Job Matching": "/jobs",
  "Resume Builder": "/resume-builder",
  "Resume Tailoring": "/ai-resume-tailoring",
  "ATS Resume Checker": "/ats-resume-checker",
  "Job Tracker": "/tracker",
  Scholarships: "/scholarships/apply-now",
  "Refer &amp; Earn": "/refer",
  Mentorship: "/mentorship",
  "Auto-Apply": "/how-auto-apply-works",
};

const COMPARE_LINKS: Record<string, string> = {
  "Jobright Alternative": "/vs/jobright",
  "vs. JobCopilot": "/vs/jobcopilot",
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

/**
 * send-474 — the footer's Scholarships link used to point at the bare
 * `/scholarships`, which proxy.ts login-gates (and robots.ts disallows). A
 * signed-out visitor or crawler following it landed on /login. The link must
 * point at a page a signed-out visitor can actually read, and this asserts that
 * against the real gate function rather than a hardcoded path, so re-gating
 * /scholarships/apply-now — or pointing the link back at the gated list — fails
 * here instead of silently reintroducing the dead end.
 */
describe("the footer's Scholarships link (send-474)", () => {
  const html = renderToStaticMarkup(<MarketingFooter />);
  const match = html.match(/<a href="([^"]+)"[^>]*>Scholarships</);

  it("links to the public apply-now hub, not the login-gated list", () => {
    expect(match, "no Scholarships anchor found in the footer").not.toBeNull();
    expect(match![1]).toBe("/scholarships/apply-now");
    expect(match![1]).not.toBe("/scholarships");
  });

  it("targets a path the seeker-app gate does NOT redirect signed-out visitors away from", () => {
    // Control: the bare list IS gated — proves this check can fail, i.e. it
    // isn't passing just because isProtectedSeekerPath always returns false.
    expect(isProtectedSeekerPath("/scholarships")).toBe(true);
    expect(isProtectedSeekerPath(match![1])).toBe(false);
  });

  it("targets a path robots.ts does not disallow", () => {
    const href = match![1];
    const rules = robots().rules;
    const disallowed = (Array.isArray(rules) ? rules : [rules]).flatMap((r) =>
      Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : [],
    );
    // Control: robots.ts DOES disallow the bare list, so a broken matcher
    // can't pass this by finding no rules at all.
    expect(disallowed).toContain("/scholarships$");
    // robots patterns here are prefixes, or `$`-anchored exact paths.
    const blocked = disallowed.some((rule) =>
      rule.endsWith("$") ? href === rule.slice(0, -1) : href.startsWith(rule),
    );
    expect(blocked, `robots.ts disallows ${href}`).toBe(false);
  });
});

describe("the footer's Compare column (send-461)", () => {
  const html = renderToStaticMarkup(<MarketingFooter />);

  it("renders a real href for both comparison pages, never a dead '#' anchor", () => {
    for (const [label, href] of Object.entries(COMPARE_LINKS)) {
      const anchor = new RegExp(`<a href="${href}"[^>]*>${label}<`);
      expect(html, `${label} did not link to ${href}`).toMatch(anchor);
    }
  });
});
