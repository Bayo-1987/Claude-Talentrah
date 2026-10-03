import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { PENDING_DELETION_PATH } from "@/lib/auth/pending-deletion-path";
import type { updateSession } from "@/lib/supabase/middleware";

/**
 * ACCT-1 — the gate on EVERY request from a session whose account is scheduled for deletion.
 *
 * Confirming a deletion ends every session with `signOut({ scope: "global" })`, but that call happens after the database transaction and can fail,
 * and a second device can be mid-request. So the proxy reads the person's flag on each request that carries a session, and a flagged session lands
 * on "Restore it, or keep the deletion?" on its very next request, whether or not the global sign-out worked. Pages are redirected; API calls get a
 * 403 JSON (a redirect is no answer to a fetch). The refreshed session cookies `updateSession` just set are copied onto the answer, because dropping
 * them would sign the person out half-way through a token refresh.
 *
 * This is the second of three gates, and none depends on another: the database hides the account from everyone else's reads (0212), this stops the
 * account's OWN session doing anything, and `requireUser()` (src/lib/auth/require-user.ts) stops its pages rendering.
 *
 * EXEMPT, because the person must still be able to restore, to leave, and to sign in: the prompt itself, /login, the auth routes, and the admin
 * surfaces (a separate identity that never reads the seeker session). Signed-out requests, cron and webhooks carry no session and are untouched.
 *
 * FAILS OPEN, DELIBERATELY AND LOUDLY. If the flag cannot be read, an ordinary person is not locked out of the app by a database blip: the database
 * still hides their account from others, and `requireUser()` checks again on every page. Failing closed here would turn one failed read into an outage
 * for everybody.
 */
const EXEMPT = [PENDING_DELETION_PATH, "/login", "/auth", "/api/auth", "/admin", "/api/admin"];

export function isExemptFromPendingDeletionGate(pathname: string): boolean {
  return EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

type SessionClient = Awaited<ReturnType<typeof updateSession>>["supabase"];

export async function pendingDeletionGate(
  request: NextRequest,
  response: NextResponse,
  user: User | null,
  supabase: SessionClient,
): Promise<NextResponse | null> {
  if (!user) return null;
  const { pathname } = request.nextUrl;
  if (isExemptFromPendingDeletionGate(pathname)) return null;

  const { data, error } = await supabase.from("profiles").select("deletion_requested_at").eq("id", user.id).maybeSingle();
  if (error) {
    console.error("[pending-deletion] gate could not read the flag, letting the request through:", error.message);
    return null;
  }
  if (!data?.deletion_requested_at) return null;

  const answer = pathname.startsWith("/api/")
    ? NextResponse.json({ error: "account_scheduled_for_deletion" }, { status: 403 })
    : NextResponse.redirect(new URL(PENDING_DELETION_PATH, request.url));
  for (const cookie of response.cookies.getAll()) answer.cookies.set(cookie);
  return answer;
}
