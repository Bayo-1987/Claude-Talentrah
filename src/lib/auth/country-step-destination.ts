import { DEFAULT_AFTER_AUTH_PATH, safeRedirectTo } from "@/lib/auth/redirect-to";
import { COUNTRY_STEP_PATH } from "@/lib/auth/google-country-gate";

/**
 * Where to go after the Google country step: the destination the person was heading for, a path on THIS site only (safeRedirectTo), and never the step
 * itself (a `next` that points back at it would loop). Its own module because it is shared by the Continue action and the sync route, and a "use server"
 * file may export nothing but async functions.
 */
export function destinationAfterStep(raw: unknown): string {
  const next = safeRedirectTo(typeof raw === "string" ? raw : null, DEFAULT_AFTER_AUTH_PATH);
  const pathname = next.split(/[?#]/)[0];
  return pathname === COUNTRY_STEP_PATH || pathname.startsWith(`${COUNTRY_STEP_PATH}/`) ? DEFAULT_AFTER_AUTH_PATH : next;
}
