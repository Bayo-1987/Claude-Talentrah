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
 * send-486 — the Compare column is REMOVED (founder's call). The two /vs pages stay live
 * and in the sitemap, and link to each other; the comparison blog post now links to both
 * (src/lib/blog/related-links.ts, pinned in tests/blog/related-links.test.ts). With it
 * gone the four remaining columns are Product | For Employers | Company & Support |
 * Legal & Trust: one row on desktop (Legal & Trust used to wrap under Product because
 * five columns sat in a four-column grid) and a 2x2 block on a phone with no empty cell.
 * The "Compare column" block at the bottom of this file was rewritten, not deleted: it
 * now asserts the column is GONE, and pins every other link against a snapshot.
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

/**
 * send-486 — the Compare column is gone; nothing else in the footer moved.
 *
 * SNAPSHOT_BEFORE is the footer's complete link list (column heading, label, href) exactly as it
 * stood before this change, copied from the component as it was on main at 28ed666 (#595). The
 * regression guard is that the footer after the change is that list MINUS the two Compare links,
 * in the same order: so a link accidentally lost, re-pointed or re-labelled while restructuring
 * fails here, rather than being noticed in production. Labels are the literal text, "&" included.
 */
const SNAPSHOT_BEFORE = [
  { heading: "Product", label: "Job Matching", href: "/jobs" },
  { heading: "Product", label: "Resume Builder", href: "/resume-builder" },
  { heading: "Product", label: "Resume Tailoring", href: "/ai-resume-tailoring" },
  { heading: "Product", label: "ATS Resume Checker", href: "/ats-resume-checker" },
  { heading: "Product", label: "Job Tracker", href: "/tracker" },
  { heading: "Product", label: "Scholarships", href: "/scholarships" },
  { heading: "Product", label: "Refer & Earn", href: "/refer" },
  { heading: "Product", label: "Mentorship", href: "/mentorship" },
  { heading: "Product", label: "Auto-Apply", href: "/how-auto-apply-works" },
  { heading: "For Employers", label: "Hire through Talentrah", href: "/employer" },
  { heading: "Compare", label: "Jobright Alternative", href: "/vs/jobright" },
  { heading: "Compare", label: "vs. FreshTalent JobCopilot", href: "/vs/jobcopilot" },
  { heading: "Company & Support", label: "About", href: "/about" },
  { heading: "Company & Support", label: "Contact", href: "/contact" },
  { heading: "Company & Support", label: "Blog", href: "/blog" },
  { heading: "Legal & Trust", label: "Privacy Policy", href: "/legal/privacy" },
  { heading: "Legal & Trust", label: "Terms of Service", href: "/legal/terms" },
  { heading: "Legal & Trust", label: "Data & Cookie Notice", href: "/legal/data-cookie-notice" },
];

const unescape = (t: string) => t.replace(/&amp;/g, "&");

/**
 * The link columns, read from the real server-rendered footer. A column is the
 * `flex flex-col gap-3.5` div holding a heading div and its anchors; the community and social
 * rows use different markup, so they cannot leak in. Asserts it found columns at all, so a change
 * to the markup fails loudly instead of yielding an empty list that every "is absent" check passes.
 */
function footerColumns(html: string) {
  const re = /<div class="flex flex-col gap-3\.5"><div class="[^"]*">([^<]*)<\/div>((?:<a [^>]*>[^<]*<\/a>)*)<\/div>/g;
  const columns: { heading: string; links: { label: string; href: string }[] }[] = [];
  for (const m of html.matchAll(re)) {
    const links = [...m[2].matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((a) => ({
      href: a[1],
      label: unescape(a[2]),
    }));
    columns.push({ heading: unescape(m[1]), links });
  }
  expect(columns.length, "found no link columns: did the footer markup change?").toBeGreaterThan(0);
  return columns;
}

/**
 * Links a LATER change re-pointed on purpose, so the snapshot above can stay exactly as it was at 28ed666
 * while the guard below still means "nothing ELSE moved". send-484 landed after send-486 and re-pointed
 * Refer & Earn: /refer has no signed-out page and stays login-gated, so the footer sends a signed-out
 * visitor through signup, which returns them to /refer. Adding to this map is a deliberate, reviewed act;
 * any other link that changes still fails the guard.
 */
const REPOINTED_SINCE: Record<string, string> = {
  "Refer & Earn": "/signup?redirectTo=%2Frefer",
};

describe("the footer's columns (send-486: Compare removed, Legal & Trust in the top row)", () => {
  const html = renderToStaticMarkup(<MarketingFooter />);
  const columns = footerColumns(html);

  it("has no Compare heading and no link to any /vs/ page", () => {
    expect(columns.map((c) => c.heading)).not.toContain("Compare");
    expect(html).not.toContain(">Compare<");
    expect(html).not.toMatch(/href="\/vs(\/|")/);
    expect(html).not.toContain("Jobright Alternative");
    expect(html).not.toContain("JobCopilot");
    // Control: the parser does see real links, so "no /vs/ link" is not an empty-parse pass.
    expect(columns.flatMap((c) => c.links).length).toBeGreaterThan(10);
  });

  it("lists the column headings in this order: Product, For Employers, Company & Support, Legal & Trust", () => {
    expect(columns.map((c) => c.heading)).toEqual(["Product", "For Employers", "Company & Support", "Legal & Trust"]);
  });

  it("Legal & Trust is its own column, not inside the Product column", () => {
    const product = columns.find((c) => c.heading === "Product")!;
    const legal = columns.find((c) => c.heading === "Legal & Trust")!;
    expect(legal.links.map((l) => l.label)).toEqual(["Privacy Policy", "Terms of Service", "Data & Cookie Notice"]);
    expect(product.links.map((l) => l.href).filter((h) => h.startsWith("/legal/"))).toEqual([]);
  });

  it("fills one row of four on desktop and a 2x2 block on a phone: no empty cell where Compare was", () => {
    // The grid is `grid-cols-2` with a four-column override from 901px. An odd number of columns
    // would leave an empty cell at 2-up; five columns at 4-up wrapped Legal & Trust under Product.
    expect(html).toContain("min-[901px]:grid-cols-4");
    expect(html).toMatch(/class="grid grid-cols-2 [^"]*min-\[901px\]:grid-cols-4"/);
    expect(columns).toHaveLength(4);
    expect(columns.length % 2).toBe(0);
  });

  it("every other link is unchanged: the footer is exactly the pre-change list minus the two Compare links", () => {
    const rendered = columns.flatMap((c) => c.links.map((l) => ({ heading: c.heading, label: l.label, href: l.href })));
    const expected = SNAPSHOT_BEFORE.filter((l) => l.heading !== "Compare").map((l) =>
      l.label in REPOINTED_SINCE ? { ...l, href: REPOINTED_SINCE[l.label] } : l,
    );
    expect(expected).toHaveLength(SNAPSHOT_BEFORE.length - 2);
    expect(rendered).toEqual(expected);
  });

  it("the rest of the footer is untouched: tagline, copyright line and closing line", () => {
    expect(html).toContain("AI-powered career platform for job seekers in Nigeria and across Africa.");
    expect(html).toContain("© 2026 Talentrah. All rights reserved.");
    expect(html).toContain("Built for job seekers in Nigeria and beyond.");
  });
});
