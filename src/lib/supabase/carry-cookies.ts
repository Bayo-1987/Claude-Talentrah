/**
 * Copies every `Set-Cookie` header of `from` onto `to`, verbatim, and returns `to`.
 *
 * WHY. `updateSession` (src/lib/supabase/middleware.ts) may renew the session on any request and puts the new, rotated session cookies on
 * its own response. A redirect or an error answer built from scratch has none of them, so the browser never hears about the new refresh
 * token; its next request presents the old, now-revoked one, and outside Supabase's 10-second reuse interval that revokes the whole
 * session. The same redirect also drops the cookie-CLEARING headers of a dead session, so the dead cookies are retried on every request.
 * Any answer the proxy builds after `updateSession` must go through this (tests/proxy/cookie-carry.test.ts scans for a bare redirect).
 *
 * The raw header values are appended, never re-parsed and re-serialised, so every attribute and every chunk of a chunked cookie survives
 * exactly as @supabase/ssr wrote it.
 */
export function carryCookies<T extends Response>(from: Response, to: T): T {
  for (const setCookie of from.headers.getSetCookie()) to.headers.append("set-cookie", setCookie);
  return to;
}
