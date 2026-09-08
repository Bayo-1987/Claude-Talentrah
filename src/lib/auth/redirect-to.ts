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

/**
 * The path every successful authentication lands on, whatever the method.
 *
 * A LITERAL SHARED BY FIVE CALL SITES, not five copies of the same string.
 * The bug this constant exists to prevent already happened: `signInAction`
 * carried its own destination (`/jobs`) while signup, the OAuth callback and
 * One Tap all carried `/onboarding`, so anyone whose email-confirmation click
 * did not cleanly land fell back to the sign-in form and skipped onboarding
 * permanently. Three entry points, two behaviours, and nothing that would fail
 * if a fourth disagreed again.
 */
export const ONBOARDING_PATH = "/onboarding";

/**
 * Where to send someone who has just authenticated — always onboarding, with
 * their intended destination carried along for onboarding to hand on at the
 * end.
 *
 * UNCONDITIONAL ON PURPOSE. This deliberately does not ask "is this a new
 * account?" or "do they have a resume?", because every version of this code
 * that answered those questions at the entry point got one of them wrong.
 * `/onboarding` itself is the single place that decides whether a given user
 * needs onboarding, and it can do that for free: `requireUser()` already loads
 * the profile it reads.
 *
 * The cost is one extra redirect hop for a returning user. That is the correct
 * trade against the alternative, which is the routing rule living in four
 * places and drifting in one of them — which is precisely how the bug this
 * fixes was introduced.
 *
 * `next` is run through `safeRedirectTo` first: it arrives from a query string
 * or a hidden form field, so it is attacker-controlled, and an unchecked value
 * echoed into a redirect is an open redirect. An unusable value costs the
 * return trip, never the sign-in.
 */
export function onboardingDestination(rawNext?: unknown): string {
  const next = safeRedirectTo(rawNext, "");
  return next ? `${ONBOARDING_PATH}?next=${encodeURIComponent(next)}` : ONBOARDING_PATH;
}
