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

  it("includes /scholarships (send-480) — public in all three places at once", () => {
    expect(STATIC_PATHS.map((p) => p.path)).toContain("/scholarships");
    expect(isProtectedSeekerPath("/scholarships")).toBe(false);
    expect(isDisallowed("/scholarships")).toBe(false);
  });
});

describe("every gated path is disallowed in robots.txt and absent from the sitemap", () => {
  const GATED = ["/jobs", "/tracker", "/refer", "/resume-builder", "/tailor", "/billing", "/settings", "/auto-apply", "/dashboard", "/mentorship/apply", "/employer/jobs"];
  for (const path of GATED) {
    it(`${path}`, () => {
      expect(isProtectedSeekerPath(path), `control: ${path} must be gated`).toBe(true);
      expect(isDisallowed(path), `${path} is gated but robots.txt does not disallow it`).toBe(true);
      expect(STATIC_PATHS.map((p) => p.path), `${path} is gated but listed in the sitemap`).not.toContain(path);
    });
  }

  it("the matcher can tell a gated list from its public detail page (so the loops above are not vacuous)", () => {
    expect(isDisallowed("/jobs")).toBe(true);
    expect(isDisallowed("/jobs/some-id")).toBe(false);
    expect(isProtectedSeekerPath("/jobs/some-id")).toBe(false);
  });
});
