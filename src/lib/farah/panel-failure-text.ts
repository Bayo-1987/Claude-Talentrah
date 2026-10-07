import { NOTHING_CHARGED_ERROR_KINDS, NOTHING_CHARGED_STATUSES, withNothingChargedNote } from "@/lib/farah/failure-note";

const GENERIC = "Something went wrong — try again.";

/**
 * The text the panel shows when the SERVER reports that a Farah message failed: a failed request (`status`, with `kind` absent) or an error event partway through the stream (`status` null, with the event's `kind`).
 * The server's own words, and the note ("... nothing was charged") ONLY for a status on the allowlist NOTHING_CHARGED_STATUSES or, for a stream error event, a kind on NOTHING_CHARGED_ERROR_KINDS. Everything
 * else (an unlisted status or kind, a missing kind, anything unknown) gets the words with no claim about charges. A dropped connection or a thrown read never comes here: the server may have finished and charged by
 * then, and the panel keeps its own text for it.
 */
export function serverFailureText(status: number | null, message?: string, kind?: string): string {
  const provenStatus = status !== null && NOTHING_CHARGED_STATUSES.includes(status);
  const provenKind = status === null && kind !== undefined && (NOTHING_CHARGED_ERROR_KINDS as readonly string[]).includes(kind);
  if (provenStatus || provenKind) return withNothingChargedNote(message);
  return message ?? GENERIC;
}
