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
import { isProtectedSeekerPath } from "@/lib/auth/seeker-gate-paths";

describe("isProtectedSeekerPath", () => {
  it("S3-23a: does NOT gate /how-match-scores-work (job pages are public, so the explainer they link to must be too)", () => {
    expect(isProtectedSeekerPath("/billing")).toBe(true); // the gate still gates
    expect(isProtectedSeekerPath("/how-match-scores-work")).toBe(false);
  });

  it("send-484: does NOT gate the bare /jobs list, /jobs/[id] or any other /jobs page", () => {
    // Control: the gate still gates. If isProtectedSeekerPath ever answered false for
    // everything, every "false" below would pass for the wrong reason.
    expect(isProtectedSeekerPath("/billing")).toBe(true);

    // /jobs is a real signed-out landing page now (components/jobs/public-landing.tsx), the
    // same shape /scholarships took in send-480. It needs no sub-path rule: /jobs/[id],
    // /jobs/remote, /jobs/in/[city] and /jobs/remote/[country] were all public already.
    expect(isProtectedSeekerPath("/jobs")).toBe(false);
    expect(isProtectedSeekerPath("/jobs/remote")).toBe(false);
    expect(isProtectedSeekerPath("/jobs/in/lagos")).toBe(false);

    // send-480 — /scholarships is NOT gated any more: its bare path is a real signed-out
    // landing page (components/scholarships/public-landing.tsx), the same shape
    // /mentorship and /employer took (send-385, send-350). Every sub-path was already
    // public, so unlike those two there is no sub-path rule to add.
    expect(isProtectedSeekerPath("/scholarships")).toBe(false);

    // /jobs/[id] and /scholarships/[id] are deliberately public.
    expect(isProtectedSeekerPath("/jobs/1ad10994-e497-4bd6-ba59-7e6611d8ec2b")).toBe(false);
    expect(isProtectedSeekerPath("/scholarships/6082edbd-bab1-4462-830e-8d40a6572463")).toBe(
      false,
    );
    expect(isProtectedSeekerPath("/scholarships/degree/phd")).toBe(false);
    expect(isProtectedSeekerPath("/scholarships/fully-funded")).toBe(false);
    expect(isProtectedSeekerPath("/scholarships/apply-now")).toBe(false);
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
      "/onboarding",
      "/dashboard",
      "/talent-directory",
    ]) {
      expect(isProtectedSeekerPath(base), base).toBe(true);
      expect(isProtectedSeekerPath(`${base}/edit`), `${base}/edit`).toBe(true);
    }
  });

  it("send-484: gates every tracker sub-path but leaves the bare /tracker landing page open", () => {
    // Same mirror-image shape as /mentorship and /employer below. The bare path is a signed-out
    // landing page; /tracker/[applicationId]/sent is the seeker's own sent document and stays gated.
    expect(isProtectedSeekerPath("/tracker")).toBe(false);
    expect(isProtectedSeekerPath("/tracker/0b6f3a0e-7a52-4f33-8a3b-0d8b0c3a1f11/sent")).toBe(true);
    expect(isProtectedSeekerPath("/tracker/anything")).toBe(true);
    // A path that merely starts with the same letters is not under it.
    expect(isProtectedSeekerPath("/trackers")).toBe(false);
  });

  it("send-484: /refer stays gated — only /jobs and /tracker were opened up", () => {
    expect(isProtectedSeekerPath("/refer")).toBe(true);
    expect(isProtectedSeekerPath("/refer/anything")).toBe(true);
  });

  it("send-385: gates every mentorship sub-path but leaves the bare list page open", () => {
    // The mirror image of the /jobs and /scholarships case above: here the
    // BARE path is the deliberately public one (a real signed-out landing
    // page as of send-385, closing a real SEO indexation gap), and every
    // sub-path stays gated. /mentorship used to sit in the plain prefix set
    // (added for #221's loading.tsx fix, before anything under it was
    // public) — this is what replaced it.
    expect(isProtectedSeekerPath("/mentorship")).toBe(false);
    expect(isProtectedSeekerPath("/mentorship/f977d1ea-c4e9-4bab-91fa-1c4661f787a3")).toBe(true);
    expect(isProtectedSeekerPath("/mentorship/apply")).toBe(true);
    expect(isProtectedSeekerPath("/mentorship/book/callback")).toBe(true);
    expect(isProtectedSeekerPath("/mentorship/reviews")).toBe(true);
    expect(isProtectedSeekerPath("/mentorship/reviews/6082edbd-bab1-4462-830e-8d40a6572463")).toBe(
      true,
    );
    expect(isProtectedSeekerPath("/mentorship/sessions")).toBe(true);
    expect(isProtectedSeekerPath("/mentorship/sessions/mentor")).toBe(true);
  });

  it("send-350: gates every employer dashboard sub-path but leaves the bare landing page open", () => {
    // Same mirror-image shape as /mentorship above, moved here for the
    // identical reason: /employer's bare path is now a real, signed-out
    // marketing page (components/employer/employer-public-landing.tsx),
    // while every actual dashboard route stays gated, each at its own page.
    expect(isProtectedSeekerPath("/employer")).toBe(false);
    expect(isProtectedSeekerPath("/employer/jobs")).toBe(true);
    expect(isProtectedSeekerPath("/employer/jobs/new")).toBe(true);
    expect(isProtectedSeekerPath("/employer/profile")).toBe(true);
    expect(isProtectedSeekerPath("/employer/campaigns")).toBe(true);
    expect(isProtectedSeekerPath("/employer/analytics")).toBe(true);
    expect(isProtectedSeekerPath("/employer/talent-directory")).toBe(true);
    expect(isProtectedSeekerPath("/employer/claim")).toBe(true);
    expect(isProtectedSeekerPath("/employer/onboarding")).toBe(true);
  });

  it("never flags a route that merely starts with the same letters", () => {
    // "/tailoring" starts with "/tailor" as a raw string but is not under it.
    expect(isProtectedSeekerPath("/tailoring")).toBe(false);
  });

  it("leaves public marketing and auth pages open", () => {
    for (const path of ["/", "/login", "/signup", "/blog", "/legal/privacy", "/contact"]) {
      expect(isProtectedSeekerPath(path), path).toBe(false);
    }
  });
});
