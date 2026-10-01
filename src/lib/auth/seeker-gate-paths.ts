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
 * Exact paths that require a session ONLY at that exact URL — a sub-path is a
 * different, public page. `/jobs/[id]` is the reason this exists as its own set
 * rather than folding into PROTECTED_PATH_PREFIXES: the LIST is gated, the DETAIL
 * page underneath it is deliberately public (see (app)/layout.tsx's own comment
 * on why /jobs/[id] had to stop redirecting Googlebot). Kept in sync with
 * src/app/robots.ts's `/jobs$` entry by hand — same distinction, different reason
 * (crawl budget there, a redirect here).
 *
 * send-480 — `/scholarships` used to be in this set for the same reason, and is
 * gone: its bare path is now a real signed-out landing page
 * (components/scholarships/public-landing.tsx), like /mentorship and /employer
 * below. Unlike those two it needs no sub-path rule: nothing under
 * /scholarships/ was ever gated ([id], apply-now, fully-funded and degree/[level]
 * were all public already), checked by listing the route directory.
 */
const PROTECTED_EXACT_PATHS = new Set(["/jobs"]);

/**
 * Path prefixes that require a session at every depth — nothing under these
 * is meant to be public. Mirrors src/app/robots.ts's disallow list (minus
 * /admin, /api, the auth pages and /jobs$, which are handled elsewhere or
 * above).
 */
const PROTECTED_PATH_PREFIXES = [
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
 * itself deliberately does not — the mirror image of PROTECTED_EXACT_PATHS
 * above, for the same reason in reverse. `/mentorship` used to sit in
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
 */
const PROTECTED_SUBPATH_ONLY_PREFIXES = ["/mentorship", "/employer"];

export function isProtectedSeekerPath(pathname: string): boolean {
  if (PROTECTED_EXACT_PATHS.has(pathname)) return true;
  if (PROTECTED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }
  return PROTECTED_SUBPATH_ONLY_PREFIXES.some((prefix) => pathname.startsWith(`${prefix}/`));
}
