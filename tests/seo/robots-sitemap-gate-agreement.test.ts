/**
 * send-480 — robots.ts, sitemap.ts and the seeker gate (seeker-gate-paths.ts) are three hand-kept
 * statements about the same fact: which paths a signed-out visitor can actually read. Each used to
 * be edited on its own, and /scholarships had to change in all three at once. This makes them
 * disagree loudly instead of silently:
 *
 *  - a page listed in the sitemap must be readable signed out AND crawlable (not gated, not
 *    disallowed) — a sitemap entry that redirects to /login, or that robots.txt forbids, is a false claim;
 *  - a path the gate blocks must be disallowed in robots.txt and absent from the sitemap.
 *
 * The matcher understands prefix rules and `$`-anchored exact rules only (see the wildcard guard in
 * tests/marketing/marketing-footer.test.tsx). Controls at the end prove it can fail.
 */
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { STATIC_PATHS } from "@/app/sitemap";
import { isProtectedSeekerPath } from "@/lib/auth/seeker-gate-paths";

const rules = robots().rules;
const disallowed: string[] = (Array.isArray(rules) ? rules : [rules]).flatMap((r) =>
  Array.isArray(r.disallow) ? r.disallow : r.disallow ? [r.disallow] : [],
);
const isDisallowed = (path: string) =>
  disallowed.some((rule) => (rule.endsWith("$") ? path === rule.slice(0, -1) : path.startsWith(rule)));

describe("every static sitemap entry is readable and crawlable signed out", () => {
  for (const { path } of STATIC_PATHS) {
    it(`${path}: not gated, not disallowed`, () => {
      expect(isProtectedSeekerPath(path), `${path} is in the sitemap but the gate redirects it to /login`).toBe(false);
      expect(isDisallowed(path), `${path} is in the sitemap but robots.txt disallows it`).toBe(false);
    });
  }

  // send-480 (/scholarships) and send-484 (/jobs, /tracker): each became a real signed-out landing
  // page, so each must be public in all three places at once.
  for (const path of ["/scholarships", "/jobs", "/tracker"]) {
    it(`includes ${path} — public in all three places at once`, () => {
      expect(STATIC_PATHS.map((p) => p.path)).toContain(path);
      expect(isProtectedSeekerPath(path)).toBe(false);
      expect(isDisallowed(path)).toBe(false);
    });
  }
});

describe("every gated path is disallowed in robots.txt and absent from the sitemap", () => {
  const GATED = [
    "/tracker/0b6f3a0e-7a52-4f33-8a3b-0d8b0c3a1f11/sent",
    "/refer",
    "/resume-builder",
    "/tailor",
    "/billing",
    "/settings",
    "/auto-apply",
    "/dashboard",
    "/mentorship/apply",
    "/employer/jobs",
  ];
  for (const path of GATED) {
    it(`${path}`, () => {
      expect(isProtectedSeekerPath(path), `control: ${path} must be gated`).toBe(true);
      expect(isDisallowed(path), `${path} is gated but robots.txt does not disallow it`).toBe(true);
      expect(STATIC_PATHS.map((p) => p.path), `${path} is gated but listed in the sitemap`).not.toContain(path);
    });
  }

  it("the matcher can tell a gated sub-path from its public bare page (so the loops above are not vacuous)", () => {
    // /employer is the long-standing example of the shape /tracker now has: bare path public, sub-paths gated.
    expect(isDisallowed("/employer/jobs")).toBe(true);
    expect(isDisallowed("/employer")).toBe(false);
    expect(isProtectedSeekerPath("/employer/jobs")).toBe(true);
    expect(isProtectedSeekerPath("/employer")).toBe(false);
  });
});
