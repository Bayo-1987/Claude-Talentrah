/**
 * send-111 — turn Groq's own rate-limit wait time into honest user-facing
 * copy, instead of the generic "try again in a moment" every LLM failure
 * got before this (send-109 traced a real outage to exactly this: Groq's
 * 200,000-token daily quota, surfaced with no indication of when it would
 * recover). Groq's error message already carries the real number:
 *
 *   "... Please try again in 12m45.504s."
 *
 * This is Groq's own wording, not a documented API contract — stable enough
 * to match on (confirmed against real production error bodies), but a
 * format change should degrade to the generic message, never throw a
 * second error on top of the first.
 */

const RETRY_AFTER_PATTERN = /please try again in (?:(\d+)m)?([\d.]+)s/i;

/** Never mention Groq, tokens, or quotas here — this is user-facing product copy, not a status page. */
export const GENERIC_FARAH_UNAVAILABLE_MESSAGE = "Farah couldn't respond just now — try again in a moment.";

/**
 * Parses Groq's "Please try again in [Xm]Y.Zs" substring out of a raw error
 * message. Returns null (never throws) when the string doesn't match —
 * callers fall back to the generic message rather than propagating a second
 * failure over a copy problem.
 */
export function parseRetryAfterSeconds(message: string): number | null {
  const match = message.match(RETRY_AFTER_PATTERN);
  if (!match) return null;
  const minutes = match[1] ? parseInt(match[1], 10) : 0;
  const seconds = parseFloat(match[2]);
  if (Number.isNaN(seconds)) return null;
  return minutes * 60 + seconds;
}

/**
 * The message to actually show the user for a `rate_limit` LLMProviderError.
 * Rounds to the nearest minute — seconds are precision nobody asked for on a
 * "try again later" message. Both failure-to-improve-on-it cases (the string
 * didn't parse; the wait is under a minute, where "about 0 minutes" would be
 * worse than saying nothing extra) fall back to the SAME generic copy every
 * other LLM failure already uses, rather than inventing a second phrasing
 * for what is really the same "no useful number to give" case.
 */
export function farahRateLimitMessage(errMessage: string): string {
  const totalSeconds = parseRetryAfterSeconds(errMessage);
  if (totalSeconds === null || totalSeconds < 60) {
    return GENERIC_FARAH_UNAVAILABLE_MESSAGE;
  }
  const minutes = Math.round(totalSeconds / 60);
  return `Farah's hit her limit for right now — try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
