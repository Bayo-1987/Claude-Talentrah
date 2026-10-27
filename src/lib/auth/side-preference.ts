/**
 * Which side of Talentrah an account that belongs to an organisation last chose to open on: the job-seeker side (/jobs) or the employer side (/employer).
 *
 * A PREFERENCE, NOT AUTHORISATION. The cookie only picks between two homes the person may already use. It is read in exactly one place (src/app/dashboard/page.tsx) and only AFTER the
 * membership row has been found; every /employer page still checks membership itself. A forged value on an account that is not a member lands on /jobs.
 *
 * It holds the word "seeker" or "employer" and nothing else (no id, no email, no organisation). It is written only by switchSideAction (src/lib/auth/switch-side.ts), after an explicit choice
 * in the account menu, and removed by both sign-out actions.
 */
export type Side = "seeker" | "employer";

export const SIDE_COOKIE = "tr_side";
export const SIDE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** The two accepted values, exactly as spelled. Anything else (empty, other case, extra text, a non-string) is null. */
export function parseSide(value: unknown): Side | null {
  return value === "seeker" || value === "employer" ? value : null;
}

/** The only places a switch ever redirects to: fixed constants, never anything taken from the request. */
export function sideRoot(side: Side): "/jobs" | "/employer" {
  return side === "employer" ? "/employer" : "/jobs";
}

export function sideCookieOptions(production: boolean): { httpOnly: true; sameSite: "lax"; secure: boolean; path: "/"; maxAge: number } {
  return { httpOnly: true, sameSite: "lax", secure: production, path: "/", maxAge: SIDE_COOKIE_MAX_AGE_SECONDS };
}

/** Removes the cookie. Takes the cookie store as an argument so the sign-out actions and their tests share one line. */
export function clearSideCookie(store: { delete: (options: { name: string; path: string }) => unknown }): void {
  store.delete({ name: SIDE_COOKIE, path: "/" });
}
