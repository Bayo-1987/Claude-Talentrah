/**
 * Where to send someone after they sign in, when they arrived from somewhere.
 *
 * THE ONLY INTERESTING PART IS WHAT IT REFUSES. `redirectTo` reaches us from a
 * query string and a hidden form field — both fully attacker-controlled — and
 * a value that is echoed into `redirect()` unchecked is an open redirect: a
 * link that looks like `talentrah.com/login?redirectTo=…` and lands the person
 * on somebody else's sign-in page, after our domain has vouched for it. That
 * is the classic vector for credential phishing, and the whole reason this
 * cannot be `redirect(raw)`.
 *
 * SAME-ORIGIN RELATIVE PATHS ONLY, and the checks are not interchangeable:
 *
 *   starts with "/"      refuses "https://evil.example" and "javascript:…" —
 *                        no scheme survives a leading slash.
 *   NOT "//"             the one that looks local and is not. A browser reads
 *                        "//evil.example/x" as protocol-relative and leaves
 *                        the site. This is the check people forget.
 *   NOT "/\"             the backslash variant. Several browsers normalise
 *                        "/\evil.example" to "//evil.example" — same escape,
 *                        different spelling.
 *
 * Anything else DROPS to the default rather than erroring. A mangled link
 * should cost the return trip, never the sign-in.
 *
 * Deliberately not reusing src/lib/feedback/schemas.ts's page-path rule: that
 * one records a fact for an operator to read, so being wrong there is
 * cosmetic. Being wrong here hands someone's session to a stranger, and the
 * two should not share a definition that could be relaxed for the other's
 * benefit.
 */
export function safeRedirectTo(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;

  const value = raw.trim();
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.startsWith("/\\")) return fallback;

  return value;
}

/** The header the proxy stamps each request with, so a Server Component can know its own path. */
export const PATH_HEADER = "x-talentrah-path";
