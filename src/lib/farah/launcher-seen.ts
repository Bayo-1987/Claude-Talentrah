/**
 * Whether this browser has seen the Farah launcher before: the store behind "the pill expands on first visits and collapses once Farah has been opened".
 *
 * DORMANT BY DESIGN (PR-1 of the mobile launcher plan): nothing imports this module yet.
 *
 * WHAT IS STORED, AND WHAT IS NOT. ONE key, `talentrah.farahLauncher`, ONE value, `{"v":1,"opened":true}`, in this browser's localStorage, written the first time the user opens Farah. Never a
 * cookie, a request, a beacon, a second key, a counter, a timestamp, an account id. Nothing in the database and nothing sent anywhere: the only reader is the launcher, on this device. The
 * same pattern as the sign-in page's remembered email (src/lib/auth/remembered-email.ts). It is not per account (a second account on the same browser sees the collapsed state) and it is cleared
 * by "clear site data".
 *
 * SAFETY. localStorage can throw on read, on write, or on merely touching `globalThis.localStorage` (blocked site data, some private windows, a sandboxed frame, the server), so every access is
 * in a try/catch and the module then behaves as if nothing were stored. The stored value is validated on the way OUT (exactly the two fields, version 1, opened true, short): anything else
 * is "not seen". When storage cannot be read at all, a module variable stands in: the pill shows once per page load (a client navigation does not re-expand it) rather than on every page.
 * The markers only act in a browser; on the server the module variables are never written, so no state is shared between requests.
 */

export const FARAH_LAUNCHER_KEY = "talentrah.farahLauncher";

const STORED_VALUE = JSON.stringify({ v: 1, opened: true });
/** The exact value is 22 characters; anything much longer is not ours. */
const MAX_STORED_LENGTH = 64;

/** The user opened Farah during this page load (also covers a store that cannot be written). */
let openedThisLoad = false;
/** The pill has been shown during this page load (only consulted when the store cannot be read). */
let pillShownThisLoad = false;

function isValidStored(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.length > MAX_STORED_LENGTH) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const keys = Object.keys(parsed);
  if (keys.length !== 2 || !keys.includes("v") || !keys.includes("opened")) return false;
  const record = parsed as Record<string, unknown>;
  return record.v === 1 && record.opened === true;
}

/** True when the pill should not expand: Farah was opened on this device before, or (storage unreadable) the pill was already shown this page load. Never throws. */
export function hasSeenLauncher(): boolean {
  if (openedThisLoad) return true;
  try {
    const raw = globalThis.localStorage.getItem(FARAH_LAUNCHER_KEY);
    if (raw === null) return false;
    return isValidStored(raw);
  } catch {
    return pillShownThisLoad;
  }
}

/** The pill was shown. Only matters when storage cannot be read. No-op outside a browser. */
export function markLauncherPillShown(): void {
  if (typeof window === "undefined") return;
  pillShownThisLoad = true;
}

/** The user opened Farah: remember it for this page load and, if storage allows, on this device. Never throws. No-op outside a browser. */
export function markLauncherOpened(): void {
  if (typeof window === "undefined") return;
  openedThisLoad = true;
  pillShownThisLoad = true;
  try {
    globalThis.localStorage.setItem(FARAH_LAUNCHER_KEY, STORED_VALUE);
  } catch {
    // Storage blocked or full: remembered for this page load only.
  }
}
