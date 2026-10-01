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
 * send-461 — a new "Compare" column (Jobright Alternative, vs. FreshTalent JobCopilot)
 * pinned the same way, so a future edit can't silently turn either into a
 * dead `#` anchor the way the original Product entries used to be.
 *
 * send-480 — the Scholarships entry is `/scholarships` again (it was
 * `/scholarships/apply-now` for send-474 while `/scholarships` was login-gated).
 * The send-474 block below is the guard that keeps it that way.
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
  Scholarships: "/scholarships",
  "Refer &amp; Earn": "/refer",
  Mentorship: "/mentorship",
  "Auto-Apply": "/how-auto-apply-works",
};

const COMPARE_LINKS: Record<string, string> = {
  "Jobright Alternative": "/vs/jobright",
  "vs. FreshTalent JobCopilot": "/vs/jobcopilot",
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
 * send-474, revised by send-480. The footer link must NEVER point at a gated page:
 * a signed-out visitor or crawler following it would land on /login. It pointed at
 * `/scholarships/apply-now` while `/scholarships` was gated; send-480 un-gated
 * `/scholarships` (a real signed-out landing page) and pointed the link back at it,
 * in the same change so it could not lead the un-gating.
 *
 * The two "not gated" / "not disallowed" assertions are the standing guard against
 * `/scholarships` going back behind login. They check the real gate function and the
 * real robots rules, and each carries controls on a path that STAYS gated and
 * disallowed (`/billing` — NOT `/tracker`, which is about to be made public), so a
 * matcher that always answers "not blocked" cannot pass them.
 */
describe("the footer's Scholarships link (send-474, revised by send-480)", () => {
  const html = renderToStaticMarkup(<MarketingFooter />);
  const match = html.match(/<a href="([^"]+)"[^>]*>Scholarships</);

  const rules = robots().rules;
  const disallowed: string[] = (Array.isArray(rules) ? rules : [rules]).flatMap((r) =>
    Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : [],
  );
  // robots patterns here are prefixes, or `$`-anchored exact paths.
  const isDisallowed = (path: string) =>
    disallowed.some((rule) => (rule.endsWith("$") ? path === rule.slice(0, -1) : path.startsWith(rule)));

  it("links to /scholarships, the public landing page", () => {
    expect(match, "no Scholarships anchor found in the footer").not.toBeNull();
    expect(match![1]).toBe("/scholarships");
  });

  it("targets a path the seeker-app gate does NOT redirect signed-out visitors away from", () => {
    // Controls: these stay gated, so the check demonstrably can fail.
    expect(isProtectedSeekerPath("/billing")).toBe(true);
    expect(isProtectedSeekerPath("/jobs")).toBe(true);
    expect(isProtectedSeekerPath(match![1])).toBe(false);
  });

  it("targets a path robots.ts does not disallow", () => {
    // Controls: the matcher blocks a prefix rule (/billing) and an anchored one (/jobs$)
    // and lets a sub-path through, so "not blocked" below cannot be a matcher that never blocks.
    expect(disallowed).toContain("/billing");
    expect(isDisallowed("/billing")).toBe(true);
    expect(isDisallowed("/jobs")).toBe(true);
    expect(isDisallowed("/jobs/some-id")).toBe(false);
    expect(isDisallowed(match![1]), `robots.ts disallows ${match![1]}`).toBe(false);
  });

  it("relies on a matcher that is exact for THIS robots.ts: no disallow rule contains a wildcard", () => {
    // isDisallowed above understands prefixes and `$`-anchored paths only. A rule such as
    // "/*?ref=" would be misjudged silently, so adding one must fail here, on purpose,
    // until the matcher is taught about it (follow-up from send-474).
    expect(disallowed.filter((rule) => rule.includes("*")), "wildcard disallow rule(s)").toEqual([]);
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
