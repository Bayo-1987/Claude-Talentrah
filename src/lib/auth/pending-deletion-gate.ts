import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { PENDING_DELETION_PATH } from "@/lib/auth/pending-deletion-path";
import { hasDeletionPendingFlag } from "@/lib/auth/pending-deletion-flag";

/**
 * ACCT-1 — the gate on EVERY request from a session whose account is scheduled for deletion, at no database cost.
 *
 * Confirming a deletion ends every session with `signOut({ scope: "global" })`, but that call happens after the database transaction and can fail,
 * and a second device can be mid-request. So the proxy turns a flagged session away on its very next request, whether or not the global sign-out worked.
 *
 * THE FLAG IS READ OFF THE USER THE PROXY ALREADY HAS. `updateSession` calls `auth.getUser()` on every request (it must, to refresh the session cookie),
 * a live call to the auth server, so `user.app_metadata.deletion_pending` is current. This function makes NO query of its own. The flag is written
 * beside `profiles.deletion_requested_at` (the source of truth) at confirm and cleared with it at restore (src/lib/account-deletion/session-flag.ts).
 *
 * Pages are redirected to "Restore it, or keep the deletion?"; API calls get a 403 JSON (a redirect is no answer to a fetch).
 *
 * THE REFRESHED SESSION COOKIES SURVIVE. `updateSession` may have just renewed the session and put new cookies on `response`. A redirect built from
 * scratch would drop them, and the person would be signed out at random on their next request. So every `Set-Cookie` header of that response is copied
 * onto the answer verbatim, attributes included (the answer is built, then the raw headers are appended; nothing is re-parsed and re-serialised).
 *
 * EXEMPT, so there is never a loop and the person can always restore, leave or sign in: the prompt itself (and anything under it), the confirm link's
 * page, /login, the auth routes (callback, sign-out), the auth API, the admin surfaces (a separate identity that never reads the seeker session), and
 * static assets (`/_next/`, and anything with a file extension: fonts, images, robots.txt, sitemap.xml, the favicon). Signed-out requests, cron and
 * webhooks carry no session and are untouched.
 *
 * THIS IS THE SECOND OF THREE GATES and none depends on another: the database hides the account from everyone else's reads (0212), this stops the
 * account's OWN session doing anything, and `requireUser()` stops its pages rendering (and records a FAIL_OPEN if the database says pending while the
 * session carried no flag, so a gate that is missing requests is visible).
 */
const EXEMPT = [PENDING_DELETION_PATH, "/settings/delete-account/confirm", "/login", "/auth", "/api/auth", "/admin", "/api/admin", "/_next"];
const HAS_FILE_EXTENSION = /\.[a-z0-9]{2,8}$/i;

export function isExemptFromPendingDeletionGate(pathname: string): boolean {
  if (HAS_FILE_EXTENSION.test(pathname)) return true;
  return EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function pendingDeletionGate(request: NextRequest, response: NextResponse, user: User | null): NextResponse | null {
  if (!user || !hasDeletionPendingFlag(user)) return null;
  const { pathname } = request.nextUrl;
  if (isExemptFromPendingDeletionGate(pathname)) return null;

  const answer = pathname.startsWith("/api/")
    ? NextResponse.json({ error: "account_scheduled_for_deletion" }, { status: 403 })
    : NextResponse.redirect(new URL(PENDING_DELETION_PATH, request.url));
  for (const setCookie of response.headers.getSetCookie()) answer.headers.append("set-cookie", setCookie);
  return answer;
}
