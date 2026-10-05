/**
 * Pass dates, as numbers a page can show. Pure: no clock of its own (the caller passes `now`) and no I/O.
 *
 * `daysLeft` is the SAME formula `getActivePass` uses for the masthead chip (src/lib/passes/entitlement.ts, `daysRemaining`): whole
 * days, rounded up, never below zero. tests/passes/pass-timing.test.ts compares the two, so the page and the chip cannot disagree.
 * It lives here rather than in entitlement.ts because that file is the gate every covered action defers to, and a display helper has
 * no business sharing a diff with it.
 */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** The clock, as a function the page can call (a component that reads Date.now() directly is flagged by the purity lint rule). */
export function nowMs(): number {
  return Date.now();
}

export function daysLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / DAY_MS));
}

export interface PassTiming {
  totalDays: number;
  daysLeft: number;
  daysUsed: number;
}

export function passTiming(startedAt: string, expiresAt: string, now: number): PassTiming {
  const totalDays = Math.max(1, Math.round((new Date(expiresAt).getTime() - new Date(startedAt).getTime()) / DAY_MS));
  const left = Math.min(totalDays, daysLeft(expiresAt, now));
  return { totalDays, daysLeft: left, daysUsed: totalDays - left };
}

/** "about ₦929 a day": plain division of the price by the days, to the nearest naira. */
export function perDayNgn(priceNgn: number, durationDays: number): number {
  return Math.round(priceNgn / durationDays);
}
