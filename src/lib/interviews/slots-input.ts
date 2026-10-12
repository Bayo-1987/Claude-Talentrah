import { MAX_DURATION, MAX_SLOTS, MIN_DURATION, MIN_SLOTS } from "./constants";

export { MAX_SLOTS, MIN_SLOTS };

export type SlotsResult = { ok: true; slots: Array<{ starts_at: string; duration_minutes: number }> } | { ok: false; error: string };

/**
 * What the employer offered, checked before the database is asked (the database checks the same rules again, in SQL, and is the one that counts): 2 to 5 distinct real instants, none less than
 * an hour from now or more than 60 days out, one length of 15 to 240 minutes. Every time is returned as UTC with an explicit Z, the form the database requires.
 */
export function validateSlots({ times, durationMinutes }: { times: string[]; durationMinutes: number }, now: Date = new Date()): SlotsResult {
  if (!Array.isArray(times) || times.length < MIN_SLOTS || times.length > MAX_SLOTS) {
    return { ok: false, error: `Offer between ${MIN_SLOTS} and ${MAX_SLOTS} times.` };
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < MIN_DURATION || durationMinutes > MAX_DURATION) {
    return { ok: false, error: `Choose a length between ${MIN_DURATION} and ${MAX_DURATION} minutes.` };
  }
  const parsed = times.map((t) => new Date(t));
  if (parsed.some((d) => Number.isNaN(d.getTime()))) return { ok: false, error: "One of the times is not a valid date and time." };
  const earliest = now.getTime() + 60 * 60_000;
  const latest = now.getTime() + 60 * 24 * 60 * 60_000;
  if (parsed.some((d) => d.getTime() < earliest)) return { ok: false, error: "Every time must be at least an hour from now." };
  if (parsed.some((d) => d.getTime() > latest)) return { ok: false, error: "Every time must be within the next 60 days." };
  const isos = parsed.map((d) => d.toISOString());
  if (new Set(isos).size !== isos.length) return { ok: false, error: "Each time must be different." };
  return { ok: true, slots: isos.map((starts_at) => ({ starts_at, duration_minutes: durationMinutes })) };
}
