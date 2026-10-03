/**
 * The seeker-app gate's path list, and the one function that answers "does a
 * signed-out request to this path get redirected to /login?".
 *
 * Extracted from src/proxy.ts (send-477) with no behaviour change. It lives in
 * its own module because anything that needs the answer — the signed-out link
 * check (e2e/signed-out-link-gate.spec.ts) and the tests that pin the footer
 * and blog links — must be able to ask without importing `next/server`, the
 * Supabase middleware and the rest of proxy.ts's module graph. proxy.ts imports
 * `isProtectedSeekerPath` from here, so there is exactly one copy of these sets.
 *
 * Everything below this comment is moved verbatim.
 */

/**
 * Path prefixes that require a session at every depth — nothing under these
 * is meant to be public. Mirrors src/app/robots.ts's disallow list (minus
 * /admin, /api and the auth pages, which are handled elsewhere).
 *
 * send-484 — `/jobs` and `/tracker` are not here. /jobs had its own exact-path entry (the LIST was gated,
 * /jobs/[id] underneath it deliberately public) and /tracker sat in this list; each is now a real
 * signed-out landing page (components/jobs/public-landing.tsx, components/tracker/public-landing.tsx), like
 * /scholarships (send-480). /jobs needs no sub-path rule — nothing under /jobs/ was ever gated. /tracker
 * does (see below): /tracker/[applicationId]/sent is the seeker's own sent document.
 */
const PROTECTED_PATH_PREFIXES = [
  "/auto-apply",
  "/billing",
  "/feedback",
  "/resume-builder",
  "/settings",
  "/tailor",
  "/onboarding",
  "/dashboard",
  /*
   * Added as part of restoring site-wide loading.tsx boundaries. Previously
   * protected ONLY by a page-level requireUser() call — never added here
   * when it shipped — which is exactly the shape #221 fixed for everything
   * else: a redirect that only a React Server Component can issue is a
   * redirect a loading.tsx anywhere in that component's ancestor chain turns
   * into a 200-with-skeleton instead of a clean 307. Confirmed directly:
   * adding a loading.tsx to talent-directory/verify with no middleware
   * backstop measured 200 for a signed-out request; adding this line and
   * re-measuring after is what makes that safe.
   */
  "/talent-directory",
];

/**
 * Paths whose SUB-PATHS require a session at every depth, but the bare path
 * itself deliberately does not. (Until send-484 there was also an exact-path
 * set here, for the opposite shape — `/jobs`, gated while /jobs/[id] was
 * public; it is gone now that /jobs is a landing page.) `/mentorship` used to sit in
 * PROTECTED_PATH_PREFIXES (blocking it AND everything under it), added for
 * #221's loading.tsx-streaming fix — real then, since nothing under
 * /mentorship was public. send-385 made the bare list page itself a genuine
 * signed-out landing page (closing a real SEO indexation gap: crawlable,
 * unblocked in robots.ts, but serving a redirect with zero unique content),
 * while mentorship/[mentorId], /apply, /book, /reviews(/[verificationId])
 * and /sessions(/mentor) all stayed authenticated-only — found to have the
 * exact same "crawlable but login-gated" pattern while investigating this
 * send, so robots.ts now disallows `/mentorship/` (trailing slash, no `$`)
 * to keep them out of the index the same way this gate keeps them out of a
 * streamed-200. A generic PROTECTED_PATH_PREFIXES entry can't express "cover
 * every sub-path except the bare path" — `pathname === prefix` is exactly
 * the case that must now return false here — so this is its own small set
 * rather than overloading that one with a boolean nobody else needs.
 *
 * send-350 — `/employer` joins this set for the identical reason
 * `/mentorship` is here: its bare path is now a real, signed-out-visitor
 * marketing page (components/employer/employer-public-landing.tsx), while
 * every actual sub-route (jobs, profile, campaigns, analytics,
 * talent-directory, claim, onboarding) still requires a session, each
 * checked at its own page — see employer/layout.tsx's own comment for why
 * the layout no longer forces that check for the whole subtree.
 *
 * send-484 — `/tracker` joins this set for the identical reason: its bare path
 * is a signed-out landing page; /tracker/[applicationId]/sent stays gated.
 *
 * Refer & Earn (send-515) — `/refer` joins it too: its bare path is a signed-out landing page (components/referrals/
 * refer-public-landing.tsx), the signed-in page keeps the same URL, and there is nothing public beneath it. Nothing under /refer exists
 * today; the sub-path rule is the safe default for whatever is added later.
 */
const PROTECTED_SUBPATH_ONLY_PREFIXES = ["/mentorship", "/employer", "/tracker", "/refer"];

export function isProtectedSeekerPath(pathname: string): boolean {
  if (PROTECTED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }
  return PROTECTED_SUBPATH_ONLY_PREFIXES.some((prefix) => pathname.startsWith(`${prefix}/`));
}
