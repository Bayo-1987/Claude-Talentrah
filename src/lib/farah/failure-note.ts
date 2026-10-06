/**
 * What the panel adds when Farah's reply FAILS: in plain words, that the reply didn't go through and that nothing was charged. Used only for what the server reports as a failed call (a rate limit, an error, a failure
 * partway through the stream): the route commits the free message, the Pass use or the credit spend only after the whole reply has succeeded, so a failed call costs nothing (see chat/route.ts and the charge tests).
 * It is deliberately NOT used when the connection itself drops: the server may have finished and charged by then, and the panel cannot know.
 */
export const NOTHING_CHARGED_NOTE = "That reply didn't go through, and nothing was charged.";

/**
 * The HTTP statuses of POST /api/farah/chat for which a test PROVES that no free message, no Pass use and no credit was used, so the panel may say "nothing was charged" (owner's rule: the note is HIDDEN
 * unless the failed request's status is on this list; an empty list means it is never shown). A status is added here ONLY together with a case in tests/farah/chat-route-failed-requests-charge-nothing.test.ts
 * that drives the route to that status and checks nothing was used; that file also fails if a listed status has no proof. Why they hold: every status the route answers with is chosen before the reply stream
 * exists, and the charge is committed only inside the stream, after a completed reply (so a request that was charged always has status 200).
 *
 * Deliberately NOT listed: 402 (its own message already says what happened), 499 (the reader went away: nothing is shown), 502 and 504 (platform gateway answers, not the route's own, so no test here can prove
 * them), and any 2xx (a stream that fails after the status line is a 200 and may have been charged: that is the "dropped connection" case above). A stream "error" event is the route's own failure report and is
 * proven separately (every error event is sent before the commit); it carries no status, so it is not in this list.
 */
export const NOTHING_CHARGED_STATUSES: readonly number[] = [400, 401, 429, 500, 503];

/** The kinds of failure the chat route reports as a stream `error` event (its `kind` field). A thrown read or a dropped connection has no kind: it is not an event the route sent. */
export type FarahStreamErrorKind = "rate_limited" | "unavailable" | "empty_reply" | "fallback_declined";

/**
 * The stream error KINDS for which a test PROVES that no free message, no Pass use and no credit was used, so the panel may say "nothing was charged" (owner's rule: hidden unless proven charge-free; an
 * unlisted or missing kind hides it). The second half of NOTHING_CHARGED_STATUSES, for failures that arrive as an `error` event inside a stream whose HTTP status was already 200. Each kind is added only
 * together with a case in tests/farah/chat-route-failed-requests-charge-nothing.test.ts that drives the route to an error event of that kind and checks nothing was used; that file also fails if a listed kind
 * has no proof. Why they hold: every `error` event is sent before the charge is committed (a source-scan test). A thrown read, a dropped connection or a timeout carries no kind and is never listed.
 */
export const NOTHING_CHARGED_ERROR_KINDS: readonly FarahStreamErrorKind[] = ["rate_limited", "unavailable", "empty_reply", "fallback_declined"];

const DEFAULT_FAILURE = "Something went wrong — try again.";

export function withNothingChargedNote(message: string | undefined): string {
  const base = message ?? DEFAULT_FAILURE;
  // A message that already says it (the busy wording says "You haven't been charged") is not told twice.
  if (/charged/i.test(base)) return base;
  return `${base} ${NOTHING_CHARGED_NOTE}`;
}
