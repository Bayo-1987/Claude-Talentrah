/**
 * Reading the employer form's "Closes" choice, and re-deriving it here.
 *
 * ── WHY THIS IS ITS OWN MODULE ────────────────────────────────────────────
 *
 * It lived in actions.ts, which is a `"use server"` file — and those may only
 * export async functions. Exporting the day-bound constant from there failed
 * the build outright ("Only async functions are allowed to be exported in a
 * 'use server' file"), which is a good error to get, because it also meant the
 * validation had no test seam: the only way in was through a Server Action.
 *
 * Here the rules are plain functions, the bound is one constant both the form
 * and the server read, and the validation can be tested directly.
 */

/** Trims a form field to a string, mirroring actions.ts' own reader. */
function str(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

/** The furthest ahead any expiry may sit, presets and custom dates alike. */
export const MAX_EXPIRY_DAYS = 365;

/**
 * How long a NEW employer-posted job stays open unless the employer picks otherwise (EMP-1 / E3). The form preselects it
 * and postJobAction applies it server-side to a submission that makes no choice. Existing postings are never given it,
 * and external postings never go through the employer form at all.
 */
export const DEFAULT_NEW_POSTING_EXPIRY_DAYS = 30;

/**
 * What the form asked for, or why it cannot be honoured.
 *
 * `value` is three-valued and each state means something different:
 *   undefined — "keep current", do not write the column at all
 *   null      — no expiry, write NULL
 *   string    — an ISO timestamp
 */
export type ExpiryChoice =
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string };

/**
 * Reads the expiry the form asked for and re-derives it here.
 *
 * ── PRESETS ARE STILL DURATIONS, NEVER DATES ──────────────────────────────
 *
 * A preset posts a NUMBER OF DAYS and the timestamp is computed here from
 * `now`. Nothing the client sends is a date, so a preset cannot carry a past
 * expiry however the request is crafted.
 *
 * ── THE CUSTOM DATE IS THE ONE PLACE A DATE ARRIVES, AND IT IS RE-CHECKED ─
 *
 * The form sets `min` and `max` on the date input so a bad date is not
 * selectable, and that is a courtesy to the person filling it in — it is not a
 * control. Anyone can post this form directly, so both bounds are enforced
 * again here against the server's own clock.
 *
 * A NOTE ON THE COMPARISON, because an earlier version of this comment claimed
 * more than the code does. Because the chosen date is normalised to the END of
 * its day, comparing instants and comparing calendar days give the same answer
 * for every input that matters — swapping one for the other was tried and no
 * test could tell the difference, which is how the overclaim was found. The
 * instant comparison is kept because it is the general form: it stays correct
 * if that end-of-day normalisation is ever changed, whereas a date-string
 * comparison silently would not.
 *
 * ── WHY THIS ONE RETURNS AN ERROR WHERE A PRESET FALLS BACK TO NULL ───────
 *
 * An out-of-range preset resolves silently to "no expiry", because the select
 * only ever offers valid values and an invalid one means the request was
 * hand-made — there is no user to inform. A custom date is the opposite: a
 * person typed it. Silently discarding it would show a form that appeared to
 * work while ignoring what was asked for, and the posting would sit there not
 * expiring with nothing anywhere saying why. So it fails loudly.
 */
export function readExpiry(
  form: FormData,
  now: Date = new Date(),
  options: { defaultDays?: number } = {},
): ExpiryChoice {
  const raw = str(form, "expiresIn");
  if (raw === "keep") return { ok: true, value: undefined };
  /*
   * ── THE DEFAULT, AND WHY IT KEYS ON THE FIELD BEING ABSENT ─────────────────
   *
   * EMP-1 / E3: a NEW employer posting closes in 30 days unless the employer chose otherwise. The form posts the
   * field on every submission ("" is the explicit "No expiry" choice), so a field that is not there at all means a
   * request that never made a choice — and only CREATION passes `defaultDays`. Editing never does, so an existing
   * posting cannot pick the default up by omission, and a hand-made edit that leaves the field out still reads as
   * "no expiry" exactly as before.
   *
   * Computed here from the server's clock for the same reason presets are: nothing the client sends is a date.
   */
  if (!form.has("expiresIn") && options.defaultDays) {
    const d = new Date(now);
    d.setDate(d.getDate() + options.defaultDays);
    return { ok: true, value: d.toISOString() };
  }
  if (!raw) return { ok: true, value: null };

  const latest = new Date(now);
  latest.setDate(latest.getDate() + MAX_EXPIRY_DAYS);

  if (raw === "custom") {
    const typed = str(form, "expiresOn");
    if (!typed) return { ok: false, error: "Pick a date for when this posting closes." };

    /*
     * A date input posts YYYY-MM-DD, which `new Date` reads as UTC midnight.
     * Taking the END of the chosen day means a posting set to close today is
     * live for the rest of today rather than already expired on submission —
     * which is what someone choosing a date means.
     */
    if (!/^\d{4}-\d{2}-\d{2}$/.test(typed)) {
      return { ok: false, error: "That closing date isn't a valid date." };
    }
    const chosen = new Date(`${typed}T23:59:59.999Z`);
    if (Number.isNaN(chosen.getTime())) {
      return { ok: false, error: "That closing date isn't a valid date." };
    }
    if (chosen.getTime() <= now.getTime()) {
      return { ok: false, error: "The closing date has to be in the future." };
    }
    if (chosen.getTime() > latest.getTime()) {
      return {
        ok: false,
        error: `The closing date can be at most ${MAX_EXPIRY_DAYS} days from now.`,
      };
    }
    return { ok: true, value: chosen.toISOString() };
  }

  const days = Number(raw);
  // Silent, deliberately — see the note above. The select cannot produce this.
  if (!Number.isFinite(days) || days <= 0 || days > MAX_EXPIRY_DAYS) {
    return { ok: true, value: null };
  }
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return { ok: true, value: d.toISOString() };
}
