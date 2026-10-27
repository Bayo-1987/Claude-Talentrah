/**
 * The Farah launcher's pure rules, part 1: which pages may show it, and how the expanded pill and the collapsed round launcher follow each other.
 *
 * DORMANT BY DESIGN (PR-1 of the mobile launcher plan). Nothing imports this module yet; the launcher component, the sheet and the AppShell change come in a later PR. It is client-safe and
 * pure: no window, no storage, no request.
 *
 * WHERE IT SHOWS. The launcher appears wherever today's bottom bar does (the signed-in app shell, below the 760px shell breakpoint) except on a short deny-list kept here and nowhere else:
 * the two payment returns and the two account-deletion pages. A floating assistant over the outcome of a payment, or over a deletion confirmation, invites a mis-tap. /billing itself is
 * allowed (it is a Farah page with its own opening line). The list is matched EXACTLY, never by prefix, after reducing the router's own spellings of the same page: a query string, a fragment,
 * any trailing slashes, and ONE level of percent-encoding (the router can hand over "/billing/%63allback", which the page also answers). Matching is case-sensitive because the routes are.
 * An unknown or missing path is allowed: the deny-list is the exception, not the rule.
 *
 * THE PILL (Option A of the plan). The server render and the first client render are collapsed. After mount the pill expands only if the launcher has not been seen before; it collapses once
 * the user has opened Farah and does not come back that page load. There is no view counter: a person who never opens Farah keeps seeing the pill.
 */

/** The shell's one breakpoint: the docked panel from here up, the launcher and the sheet below it. */
export const FARAH_SHELL_BREAKPOINT_PX = 760;

/** True for a real, positive width strictly below the shell breakpoint. */
export function isPhoneWidth(widthPx: number): boolean {
  return typeof widthPx === "number" && Number.isFinite(widthPx) && widthPx > 0 && widthPx < FARAH_SHELL_BREAKPOINT_PX;
}

/** The four routes that never show the launcher. Exact paths, no wildcards. */
export const FARAH_LAUNCHER_DENIED_PATHS: readonly string[] = Object.freeze([
  "/billing/callback",
  "/mentorship/book/callback",
  "/settings/account-deletion",
  "/settings/delete-account/confirm",
]);

/** The path as the deny-list compares it: without a query or fragment, percent-decoded once (as written if it will not decode), without trailing slashes. */
function comparable(pathname: string): string {
  let path = pathname.split(/[?#]/)[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    // malformed percent sequence: judged as written
  }
  return path.replace(/\/+$/, "");
}

/** Whether the launcher may appear on this path. Never throws; anything that is not a string is allowed. */
export function farahLauncherAllowedFor(pathname: string | null | undefined): boolean {
  if (typeof pathname !== "string") return true;
  return !FARAH_LAUNCHER_DENIED_PATHS.includes(comparable(pathname));
}

export interface LauncherState {
  /** The pill ("Ask Farah · AI assistant") is showing instead of the round launcher. */
  expanded: boolean;
  /** The user has opened Farah during this page load. */
  opened: boolean;
}

export type LauncherEvent = { type: "mounted"; seen: boolean } | { type: "opened" };

/** Collapsed until the browser has mounted the launcher and read whether it was seen. */
export const INITIAL_LAUNCHER_STATE: LauncherState = Object.freeze({ expanded: false, opened: false });

export function launcherReducer(state: LauncherState, event: LauncherEvent): LauncherState {
  switch (event.type) {
    case "mounted":
      // A read that arrives after the user already opened Farah must not bring the pill back.
      if (state.opened) return state;
      return { expanded: !event.seen, opened: false };
    case "opened":
      return { expanded: false, opened: true };
    default:
      return state;
  }
}
