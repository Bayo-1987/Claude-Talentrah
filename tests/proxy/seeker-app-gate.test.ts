/**
 * isProtectedSeekerPath (src/proxy.ts) — the path list the seeker-app gate
 * uses to decide whether a signed-out request should be redirected to
 * /login before the App Router (and any route's loading.tsx) ever engages.
 *
 * WHY THIS GATE EXISTS. Every route under (app) with a loading.tsx has a
 * Next.js App Router characteristic that isn't a bug in this codebase: once
 * a route has a loading.tsx, Next streams that fallback — committing the
 * response to HTTP 200 — before the async page component has run far enough
 * to call `redirect()` or `notFound()`. Confirmed directly against a real
 * built server: a protected route with no session cookie returned 200 with
 * this gate absent, 307 with it present; a below-threshold scholarship
 * landing page and a missing job/scholarship returned 200 instead of 404 for
 * the identical reason. Proxy middleware runs BEFORE the App Router engages
 * at all, so a redirect issued there is a clean 307 with no streaming
 * involved — this test only covers the PATH LIST that decision is keyed on,
 * not the streaming behaviour itself (that needs a real server; see
 * e2e/public-job-page.spec.ts, e2e/public-scholarship-page.spec.ts,
 * e2e/seo-landing-pages-sitemap.spec.ts, e2e/job-detail.spec.ts and
 * e2e/job-freshness.spec.ts, which assert the actual status codes and are
 * the real regression coverage for this).
 *
 * KEPT IN SYNC WITH src/app/robots.ts BY HAND, not by importing one from the
 * other — same underlying distinction (which paths are gated) for a
 * different reason (crawl budget there, a redirect here), and the two lists
 * happening to diverge would be a real bug worth a human noticing rather
 * than one silently absorbing the other's exceptions.
 */
import { describe, expect, it } from "vitest";
import { isProtectedSeekerPath } from "@/proxy";

describe("isProtectedSeekerPath", () => {
  it("gates the bare list routes but not their public detail pages", () => {
    expect(isProtectedSeekerPath("/jobs")).toBe(true);
    expect(isProtectedSeekerPath("/scholarships")).toBe(true);

    // The whole reason this is a separate exact-match set rather than a
    // prefix: /jobs/[id] and /scholarships/[id] are deliberately public.
    expect(isProtectedSeekerPath("/jobs/1ad10994-e497-4bd6-ba59-7e6611d8ec2b")).toBe(false);
    expect(isProtectedSeekerPath("/scholarships/6082edbd-bab1-4462-830e-8d40a6572463")).toBe(
      false,
    );
    expect(isProtectedSeekerPath("/scholarships/degree/phd")).toBe(false);
    expect(isProtectedSeekerPath("/scholarships/fully-funded")).toBe(false);
  });

  it("gates every depth under the prefix routes", () => {
    for (const base of [
      "/auto-apply",
      "/billing",
      "/feedback",
      "/refer",
      "/resume-builder",
      "/settings",
      "/tailor",
      "/tracker",
      "/onboarding",
      "/dashboard",
      "/employer",
    ]) {
      expect(isProtectedSeekerPath(base), base).toBe(true);
      expect(isProtectedSeekerPath(`${base}/edit`), `${base}/edit`).toBe(true);
    }
  });

  it("never flags a route that merely starts with the same letters", () => {
    // "/jobsomething" starts with "/jobs" as a raw string but is not under
    // it — the exact-match set must not accidentally become a prefix match.
    expect(isProtectedSeekerPath("/jobsomething")).toBe(false);
    expect(isProtectedSeekerPath("/tailoring")).toBe(false);
  });

  it("leaves public marketing and auth pages open", () => {
    for (const path of ["/", "/login", "/signup", "/blog", "/legal/privacy", "/contact"]) {
      expect(isProtectedSeekerPath(path), path).toBe(false);
    }
  });
});
