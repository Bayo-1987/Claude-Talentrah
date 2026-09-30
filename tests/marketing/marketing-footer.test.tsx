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
 *
 * send-484 — /jobs and /tracker are public landing pages now, so "Job Matching" and
 * "Job Tracker" keep their hrefs and stop being gated. /refer has no landing page and
 * stays gated, so "Refer & Earn" links to /signup?redirectTo=%2Frefer instead: a signed-out
 * visitor gets the signup form, and a signed-in one lands on /refer after it. That href
 * contains a `?`, which broke this file's own matcher (see footerAnchor below).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { isProtectedSeekerPath } from "@/lib/auth/seeker-gate-paths";
import robots from "@/app/robots";

/** Escape a string for use inside a RegExp — an href can contain `?`, `.` and other metacharacters. */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const footerAnchor = (href: string, label: string) =>
  new RegExp(`<a href="${escapeRegExp(href)}"[^>]*>${escapeRegExp(label)}<`);

const PRODUCT_LINKS: Record<string, string> = {
  "Job Matching": "/jobs",
  "Resume Builder": "/resume-builder",
  "Resume Tailoring": "/ai-resume-tailoring",
  "ATS Resume Checker": "/ats-resume-checker",
  "Job Tracker": "/tracker",
  Scholarships: "/scholarships",
  "Refer &amp; Earn": "/signup?redirectTo=%2Frefer",
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
      expect(html, `${label} did not link to ${href}`).toMatch(footerAnchor(href, label));
    }
  });

  it("finds an href that contains a `?` (send-484: Refer & Earn -> /signup?redirectTo=%2Frefer)", () => {
    expect(html).toMatch(footerAnchor("/signup?redirectTo=%2Frefer", "Refer &amp; Earn"));
    // Control: the matcher this file used before — the href spliced in raw — treats the `?` as a
    // quantifier and cannot find that anchor, which is exactly why the escape exists.
    expect(html).not.toMatch(new RegExp(`<a href="/signup?redirectTo=%2Frefer"[^>]*>Refer &amp; Earn<`));
    // And the escaped matcher is not vacuous: it rejects a wrong target.
    expect(html).not.toMatch(footerAnchor("/refer", "Refer &amp; Earn"));
  });

  it("send-484: sends Refer & Earn through signup, not straight at the gated /refer", () => {
    expect(html).not.toMatch(footerAnchor("/refer", "Refer &amp; Earn"));
    expect(isProtectedSeekerPath("/refer"), "control: /refer stays gated").toBe(true);
    expect(isProtectedSeekerPath("/signup")).toBe(false);
  });

  it("send-484: Job Matching and Job Tracker point at paths the gate no longer redirects", () => {
    expect(isProtectedSeekerPath("/billing"), "control: the gate still gates").toBe(true);
    for (const label of ["Job Matching", "Job Tracker"]) {
      const m = html.match(new RegExp(`<a href="([^"]+)"[^>]*>${label}<`));
      expect(m, `no ${label} anchor`).not.toBeNull();
      expect(isProtectedSeekerPath(new URL(m![1], "http://site.test").pathname), `${label} -> ${m![1]}`).toBe(false);
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
    expect(isProtectedSeekerPath("/refer")).toBe(true);
    expect(isProtectedSeekerPath(match![1])).toBe(false);
  });

  it("targets a path robots.ts does not disallow", () => {
    // Controls: the matcher blocks a prefix rule (/billing) and a trailing-slash one (/tracker/)
    // and lets the bare path through, so "not blocked" below cannot be a matcher that never blocks.
    expect(disallowed).toContain("/billing");
    expect(isDisallowed("/billing")).toBe(true);
    expect(isDisallowed("/tracker/some-id/sent")).toBe(true);
    expect(isDisallowed("/tracker")).toBe(false);
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
