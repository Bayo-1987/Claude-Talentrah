import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { ADMIN_COOKIE } from "@/lib/admin/cookie";

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

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
