/**
 * True when `cookieString` (document.cookie) carries Supabase's auth cookie: `sb-<project ref>-auth-token`, or its `.0`, `.1` chunks. Presence only: it picks which links the
 * marketing masthead shows, and every protected page still checks the real session on the server (HWR-2). The `-code-verifier` cookie of an in-flight sign-in is NOT a session.
 */
export function hasAuthCookie(cookieString: string): boolean {
  return /(?:^|;\s*)sb-[^=;\s]+-auth-token(?:\.\d+)?=/.test(cookieString);
}
