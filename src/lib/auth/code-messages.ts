/**
 * The words on the signup code page (S1-101). Plain: what happened, and what to do. One message covers a wrong code, an expired code and an address with no
 * account, because the answer from Supabase is the same for all three on purpose and the page must not be a way to find out which addresses have accounts.
 */
export const CODE_WRONG_OR_EXPIRED = `That code didn't work. It may be wrong, or it may have expired. Check the 6 digits, or use "Resend code" to get a new one.`;
export const CODE_FORMAT = "Enter the 6-digit code from the email.";
export const CODE_SERVICE_TROUBLE = "We couldn't check that code just now. Try again in a moment.";
export const CODE_ENDED = "This step has timed out. Go back to sign up and we'll send a new code.";

/** "Too many tries" with how long to wait, from the end of the rate-limit window when it is known. */
export function codeRateLimitedMessage(resetsAt: string | null, now: number): string {
  const ms = resetsAt ? Date.parse(resetsAt) - now : Number.NaN;
  if (!Number.isFinite(ms)) return "Too many tries. Wait a few minutes, then enter the code again.";
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return `Too many tries. Wait about ${minutes} ${minutes === 1 ? "minute" : "minutes"}, then enter the code again.`;
}

export const RESEND_SENT = "We sent a new code. Check your inbox.";
export const RESEND_RATE_LIMITED = "That's a lot of requests for this address — try again later.";
export const RESEND_GENERIC_ERROR = "Couldn't resend that — try again in a moment.";
/** Supabase refused because of its own hourly cap on emails (not a pause we can count down, and not our daily per-address budget). */
export const RESEND_PROVIDER_LIMITED = "We can't send another email right now. Try again in a little while.";
/** "For security purposes, you can only request this after 3 seconds." -> 3. Anything else -> null. */
export function providerPauseSeconds(message: string | undefined): number | null {
  const match = /after\s+(\d+)\s+seconds?/i.exec(message ?? "");
  if (!match) return null;
  const seconds = Number(match[1]);
  return seconds >= 1 && seconds <= 3600 ? seconds : null;
}
export function resendCooldownMessage(seconds: number): string {
  return `You can ask for another code in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
}
