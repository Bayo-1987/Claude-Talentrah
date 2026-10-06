import { withNothingChargedNote } from "@/lib/farah/failure-note";

/**
 * The text the panel shows when the SERVER reports that a Farah message failed: a failed request (`status`) or an error event partway through the
 * stream (`status` null). The server's own words come first and S3's note ("... nothing was charged") follows, because the route commits a charge
 * only after the whole reply succeeded. A 402 (not enough credits) is shown exactly as the server words it: that message already says what
 * happened, and the note would only repeat it. Never used for a dropped connection: the server may have finished and charged by then.
 */
export function serverFailureText(status: number | null, message?: string): string {
  if (status === 402 && message) return message;
  return withNothingChargedNote(message);
}
