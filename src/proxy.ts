import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { updateSession } from "@/lib/supabase/middleware";
import { ADMIN_COOKIE } from "@/lib/admin/cookie";
import { createPublicReadClient } from "@/lib/supabase/public-read";
import { REFERRAL_CODE_PATTERN, REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE_SECONDS } from "@/lib/referrals/cookie";

/**
 * A first pass on /admin, before anything renders.
 *
 * WHAT THIS IS AND IS NOT. It only checks that an admin cookie is PRESENT. It
 * does not — cannot cheaply, and should not — decide whether the token behind
 * it is valid, unrevoked, unexpired, or belongs to an admin who still works
 * here. That decision needs the database and belongs to `requireAdmin()` in
 * src/app/admin/(protected)/layout.tsx, which every protected page passes
 * through.
 *
 * So this is a courtesy, not the gate: it turns "signed-out visitor lands on a
 * flash of admin chrome, then bounces" into a clean redirect, and it means a
 * request with no credential never reaches a Server Component at all. Deleting
 * it would not open anything. Relying on it INSTEAD of the layout guard would
 * open everything — a forged cookie of any value would pass.
 */
function adminGate(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;

  // Only the human-facing pages. /api/admin/* is a different surface with
  // different auth — see the note below — and does not start with "/admin".
  if (!pathname.startsWith("/admin")) return null;
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) return null;

  if (request.cookies.get(ADMIN_COOKIE)) return null;

  const url = request.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = "";
  url.searchParams.set("redirectTo", pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

/**
 * Exact paths that require a session ONLY at that exact URL — a sub-path is a
 * different, public page. `/jobs/[id]` and `/scholarships/[id]` are the
 * reason this exists as its own set rather than folding into
 * PROTECTED_PATH_PREFIXES: the LIST is gated, the DETAIL page underneath it
 * is deliberately public (see (app)/layout.tsx's own comment on why
 * /jobs/[id] had to stop redirecting Googlebot). Kept in sync with
 * src/app/robots.ts's `/jobs$` / `/scholarships$` entries by hand — same
 * distinction, different reason (crawl budget there, a redirect here).
 */
const PROTECTED_EXACT_PATHS = new Set(["/jobs", "/scholarships"]);

/**
 * Path prefixes that require a session at every depth — nothing under these
 * is meant to be public. Mirrors src/app/robots.ts's disallow list (minus
 * /admin, /api, the auth pages and /jobs$ / /scholarships$, which are handled
 * elsewhere or above).
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
  "/employer",
];

export function isProtectedSeekerPath(pathname: string): boolean {
  if (PROTECTED_EXACT_PATHS.has(pathname)) return true;
  return PROTECTED_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * A first pass on the seeker app's protected pages, before anything renders —
 * same shape and same reasoning as `adminGate` above, added for a different
 * reason. `requireUser()` (src/lib/auth/require-user.ts) is still the
 * authoritative gate and is UNCHANGED; this is a courtesy in front of it.
 *
 * WHY THIS EXISTS NOW, SPECIFICALLY: every route under (app) with its own
 * `loading.tsx` (added for perceived responsiveness — see the "instant nav"
 * work) has a real correctness bug underneath the skeleton. Once a route has
 * a `loading.tsx`, Next.js streams that fallback — and commits the response
 * to HTTP 200 — before the async page component has run far enough to call
 * `redirect()`. The redirect still happens (the browser does bounce to
 * /login), but the FIRST response Next sent was a 200, not the 307 a
 * signed-out visitor or a crawler is entitled to see. Confirmed directly: a
 * plain `curl` against a protected route with no session cookie returned
 * `HTTP/1.1 200 OK` before this gate existed, `307` after.
 *
 * Proxy middleware runs BEFORE the App Router engages at all — no page
 * component, no Suspense boundary, no loading.tsx — so a redirect issued
 * here is a clean 307 with no streaming involved, and every protected page's
 * `loading.tsx` becomes safe again: by the time a request reaches the page
 * component, this gate has already guaranteed it belongs to a signed-in
 * session.
 *
 * `user` comes from `updateSession`'s own `auth.getUser()` call, not a
 * second one — that call already has to happen on every request to refresh
 * the session cookie, so checking its result here costs nothing extra.
 */
function seekerAppGate(request: NextRequest, user: User | null): NextResponse | null {
  if (user) return null;
  if (!isProtectedSeekerPath(request.nextUrl.pathname)) return null;

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("redirectTo", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

/**
 * Referral capture, on any route — not just /signup.
 *
 * WHY HERE, NOT ONLY ON /signup. `getReferralUrl` only ever built
 * `/signup?ref=CODE`, so the code travelled exclusively as a query param
 * `signup/page.tsx` read straight off `searchParams`. That is fine for a
 * link that points at /signup. It is the wrong shape for a link that has to
 * point at the shared content itself — a scholarship page, eventually a job
 * — because a signup wall in front of shared content is how a WhatsApp share
 * dies. So the code has to be picked up wherever the visitor actually lands,
 * which is any route, which is why this lives in the proxy rather than in
 * one page.
 *
 * FIRST-TOUCH, NOT LAST-TOUCH — an existing cookie is NEVER overwritten. The
 * same scholarship gets shared into the same WhatsApp group by several
 * people; first-touch means whoever the visitor saw FIRST keeps the credit,
 * so a later sharer can't take it from them.
 *
 * NO SESSION CHECK, NO COOKIE. A signed-in visitor clicking a friend's link
 * isn't a referral — they already have an account. Checked with the same
 * `user` `updateSession` already fetched, not a second auth call.
 *
 * VALIDATED, NOT TRUSTED. An unknown code is ignored silently — no error, no
 * redirect, nothing that tells a visitor probing for valid codes whether
 * theirs landed. The shape check (`REFERRAL_CODE_PATTERN`) is cheap and runs
 * first so a request that's obviously not even trying passes a real code
 * never reaches the database; the actual check is `is_valid_referral_code`
 * (migration 0098), a SECURITY DEFINER function that can only ever answer
 * true/false — see that migration for why a wider read isn't used instead.
 * `.rpc(name, { p_code })` is a parameterised call, never a string
 * interpolated into SQL.
 *
 * WHAT THIS DOES NOT TOUCH: reward amounts, `grant_referral_reward`, the
 * activation condition (0092), or the self-referral guard (0036). Those all
 * still run exactly where they already did — inside `handle_new_user`, off
 * `referred_by_code` in the new user's own metadata at signup. This function
 * only ever decides whether a cookie gets set; `SignupForm`/`signUpAction`
 * decide what a cookie value turns into, unchanged.
 *
 * NOT CASE-NORMALISED, DELIBERATELY. `tests/referrals/referrals.test.ts`
 * ("referral code lookup ... is case-SENSITIVE") pins that `handle_new_user`'s
 * own lookup does no case folding — a lowercased copy of a real code
 * attributes nothing there, as a documented, deliberate non-fix rather than a
 * bug. Upper-casing here would make THIS path more forgiving than the one
 * signup itself uses, which is a worse inconsistency than either being
 * strict: `REFERRAL_CODE_PATTERN` accepts either case only to cheaply reject
 * non-hex garbage before touching the database, and the code that reaches the
 * cookie (and, from there, `referredByCode`) is whatever the visitor's URL
 * actually carried — same behaviour, same failure mode, at both ends.
 */
async function captureReferral(request: NextRequest, response: NextResponse, user: User | null) {
  if (user) return;
  if (request.cookies.get(REFERRAL_COOKIE)) return;

  const code = request.nextUrl.searchParams.get("ref");
  if (!code || !REFERRAL_CODE_PATTERN.test(code)) return;

  const supabase = createPublicReadClient();
  const { data: isValid, error } = await supabase.rpc("is_valid_referral_code", {
    p_code: code,
  });
  if (error || !isValid) return;

  response.cookies.set(REFERRAL_COOKIE, code, {
    httpOnly: true,
    sameSite: "lax",
    // Matches src/lib/admin/session.ts's own rule, for the same reason: a
    // hardcoded `secure: true` is silently dropped by the browser over plain
    // HTTP, which is exactly how local dev and this suite's own CI server run.
    secure: process.env.NODE_ENV === "production",
    maxAge: REFERRAL_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}

/**
 * THE CRON AND INGEST ROUTES ARE NOT TOUCHED BY ANY OF THIS, and that is a
 * decision rather than an omission.
 *
 * /api/admin/ingest-jobs, /api/admin/ingest-scholarships,
 * /api/admin/renew-passes, /api/admin/charge-campaigns and
 * /api/admin/estimate-llm-costs are triggered by Vercel Cron and by an
 * operator with curl. There is no browser, no cookie jar and nobody to click a
 * login form; Vercel sends a fixed `Authorization: Bearer <CRON_SECRET>` that
 * is not ours to change. A session cookie cannot authenticate a caller that
 * has no session, so migrating them to admin auth would mean either breaking
 * the schedule or minting a long-lived session for a machine — which is a
 * shared secret again, with more moving parts and an expiry that can silently
 * stop a nightly job.
 *
 * They keep `requireCronSecret` / `requireAdminSecret`, unchanged.
 *
 * The split that matters is BY CALLER, not by URL prefix. The routes under
 * /api/admin that a HUMAN operated — moderate-scholarship, moderate-campaign,
 * moderate-job-posting, and the scholarships POST — were the ones whose shared
 * secret was the wrong mechanism, because it is why they recorded
 * `reviewed_by = null`. Those are GONE: the screens that replaced them
 * (/admin/scholarships, /admin/campaigns, /admin/reports) call Server Actions
 * behind `requirePermission`, so every decision now names an operator. The
 * routes were deleted rather than left in place next to the screens, because a
 * second way in is a second thing to remember to close.
 *
 * What survives here is the cron set above, unchanged and correctly so.
 */
export async function proxy(request: NextRequest) {
  const gated = adminGate(request);
  if (gated) return gated;

  const { response, user } = await updateSession(request);

  const seekerGated = seekerAppGate(request, user);
  const finalResponse = seekerGated ?? response;

  await captureReferral(request, finalResponse, user);

  return finalResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
