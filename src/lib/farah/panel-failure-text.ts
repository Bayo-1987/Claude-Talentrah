import { NOTHING_CHARGED_STATUSES, withNothingChargedNote } from "@/lib/farah/failure-note";

const GENERIC = "Something went wrong — try again.";

/**
 * The text the panel shows when the SERVER reports that a Farah message failed: a failed request (`status`) or an error event partway through the stream (`status` null). The server's own words, and the
 * note ("... nothing was charged") ONLY when `status` is on the allowlist NOTHING_CHARGED_STATUSES; every other status, a missing status and anything unknown get the words with no claim about charges.
 * A dropped connection never comes here: the server may have finished and charged by then, and the panel keeps its own text for it.
 */
export function serverFailureText(status: number | null, message?: string): string {
  if (status !== null && NOTHING_CHARGED_STATUSES.includes(status)) return withNothingChargedNote(message);
  return message ?? GENERIC;
}
