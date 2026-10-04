/**
 * ACCT-1 — every place the pending-deletion gate lets something through that it should have stopped is recorded here, never silent.
 *
 * The gate reads `app_metadata.deletion_pending` off the user the proxy already fetched, and that flag is written beside the database flag at confirm and
 * restore. Either write can fail; the database flag is the source of truth and everyone else's reads are hidden by it regardless, so a failure is
 * survivable. It must not be invisible, though, so each one logs a line with a running count:
 *
 *     [pending-deletion] FAIL_OPEN kind=<kind> count=<n> <detail>
 *
 * Kinds: `flag_not_set` (confirm scheduled the deletion but could not set the session flag), `flag_not_cleared` (restore worked but the flag stayed),
 * `gate_missed` (requireUser found the database saying pending while the session carried no flag: the gate let a request through that it should not).
 *
 * The count is per server instance (a serverless counter cannot be global), so it shows a run of failures in one instance's logs; searching the logs for
 * `FAIL_OPEN` across instances is the real total.
 */
export type PendingDeletionFailOpenKind = "flag_not_set" | "flag_not_cleared" | "gate_missed";

let count = 0;

export function recordPendingDeletionFailOpen(kind: PendingDeletionFailOpenKind, detail = ""): number {
  count += 1;
  console.error(`[pending-deletion] FAIL_OPEN kind=${kind} count=${count}${detail ? ` ${detail}` : ""}`);
  return count;
}

export function pendingDeletionFailOpenCount(): number {
  return count;
}
