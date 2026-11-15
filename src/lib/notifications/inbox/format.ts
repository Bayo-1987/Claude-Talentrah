/** The bell shows a count capped at "9+" (a number, not a meter). */
export const BELL_COUNT_CAP = 9;

/** 0 to 9 show as themselves, 10 and above as "9+". A value that is not a usable count shows as "0". */
export function formatUnreadCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "0";
  const whole = Math.floor(count);
  return whole > BELL_COUNT_CAP ? `${BELL_COUNT_CAP}+` : String(whole);
}
