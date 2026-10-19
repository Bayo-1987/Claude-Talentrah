/**
 * The POST's same-origin rule: the request's `Origin` (or, when there is none, its `Referer`) must name the host the request ARRIVED ON, host AND port, compared case-insensitively.
 *
 * NEVER a hard-coded domain: a preview deployment (`*.vercel.app`) and production both work because the comparison is against the request's own `Host`. `x-forwarded-host` is deliberately NOT read:
 * a client can send it, and Vercel delivers the real host in `Host`.
 *
 *   - `Origin: null` (a sandboxed frame, a cross-origin redirect, a file) does not parse as a URL, so it is refused.
 *   - An `Origin` that is present decides the question; `Referer` is only the fallback when `Origin` is absent. Both absent is refused.
 *   - A different port is a different origin.
 */
export function isOwnOrigin(request: Request): boolean {
  let own: string;
  try {
    own = (request.headers.get("host") ?? new URL(request.url).host).toLowerCase();
  } catch {
    return false;
  }
  const origin = request.headers.get("origin");
  const source = origin !== null ? origin : request.headers.get("referer");
  if (!source) return false;
  try {
    const url = new URL(source);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return url.host.toLowerCase() === own;
  } catch {
    return false;
  }
}
