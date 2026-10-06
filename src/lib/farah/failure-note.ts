/**
 * What the panel adds when Farah's reply FAILS: in plain words, that the reply didn't go through and that nothing was charged. Used only for what the server reports as a failed call (a rate limit, an error, a failure
 * partway through the stream): the route commits the free message, the Pass use or the credit spend only after the whole reply has succeeded, so a failed call costs nothing (see chat/route.ts and the charge tests).
 * It is deliberately NOT used when the connection itself drops: the server may have finished and charged by then, and the panel cannot know.
 */
export const NOTHING_CHARGED_NOTE = "That reply didn't go through, and nothing was charged.";

const DEFAULT_FAILURE = "Something went wrong — try again.";

export function withNothingChargedNote(message: string | undefined): string {
  const base = message ?? DEFAULT_FAILURE;
  // A message that already says it (the busy wording says "You haven't been charged") is not told twice.
  if (/charged/i.test(base)) return base;
  return `${base} ${NOTHING_CHARGED_NOTE}`;
}
