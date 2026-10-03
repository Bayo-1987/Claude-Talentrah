/**
 * The session-side half of the pending-deletion flag, readable anywhere (the proxy, `requireUser`) because it imports nothing server-only.
 * Written only by src/lib/account-deletion/session-flag.ts with the service role. See that file for why `app_metadata`.
 */
export const DELETION_PENDING_KEY = "deletion_pending";

/** True when this auth user's `app_metadata` carries the gate flag, exactly `true` (a stale string or number never locks anyone out). */
export function hasDeletionPendingFlag(user: { app_metadata?: Record<string, unknown> | null } | null | undefined): boolean {
  return user?.app_metadata?.[DELETION_PENDING_KEY] === true;
}
