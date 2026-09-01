/**
 * What the "Closes" field is allowed to produce.
 *
 * ── WHY A CUSTOM DATE NEEDED ITS OWN RULES ────────────────────────────────
 *
 * The field was presets-only, deliberately, and its comment gave the reason: a
 * raw date input invites "a date in the past, and a typo three years out". A
 * custom date was asked for, so those two failures had to be made unreachable
 * some other way — by bounds at both ends, checked HERE rather than only in
 * the browser.
 *
 * The `min`/`max` on the input are a courtesy to whoever is filling the form.
 * They are not a control: anyone can post the form directly, so every bound is
 * re-derived server-side against the server's own clock. These tests are about
 * that second check, because it is the only one that actually holds.
 */
import { describe, expect, it } from "vitest";
import { MAX_EXPIRY_DAYS, readExpiry } from "@/lib/employer/expiry-input";

const NOW = new Date("2026-08-31T18:00:00.000Z");

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const day = (offset: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

describe("the three states that are not a date at all", () => {
  it("'keep' means do not touch the column", () => {
    // Undefined, not null. The update spreads it out entirely, so an unrelated
    // edit cannot restart the countdown.
    expect(readExpiry(form({ expiresIn: "keep" }), NOW)).toEqual({ ok: true, value: undefined });
  });

  it("empty means no expiry", () => {
    expect(readExpiry(form({ expiresIn: "" }), NOW)).toEqual({ ok: true, value: null });
    expect(readExpiry(form({}), NOW)).toEqual({ ok: true, value: null });
  });
});

describe("presets are durations, never dates", () => {
  it.each([1, 3, 7, 14, 30, 60])("%s days lands that many days out", (days) => {
    const out = readExpiry(form({ expiresIn: String(days) }), NOW);
    expect(out.ok).toBe(true);
    const value = (out as { value: string }).value;
    const delta = (new Date(value).getTime() - NOW.getTime()) / 86_400_000;
    expect(delta).toBeCloseTo(days, 5);
  });

  it("is computed from the server's clock, so a preset can never be in the past", () => {
    for (const days of [1, 3, 7, 14, 30, 60]) {
      const out = readExpiry(form({ expiresIn: String(days) }), NOW) as { value: string };
      expect(new Date(out.value).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it("falls back SILENTLY to no expiry for an out-of-range preset", () => {
    /*
     * Deliberately different from the custom-date path. The select can only
     * emit the offered values, so anything else means a hand-made request —
     * there is no person to tell, and refusing would only give a crafted post
     * a way to make the form talk back.
     */
    for (const bad of ["0", "-5", "9999", "abc", "1e9"]) {
      expect(readExpiry(form({ expiresIn: bad }), NOW), bad).toEqual({ ok: true, value: null });
    }
  });
});

describe("a custom date is bounded at both ends, and refused loudly", () => {
  it("accepts a date inside the window, closing at the END of that day", () => {
    const out = readExpiry(form({ expiresIn: "custom", expiresOn: day(10) }), NOW);
    expect(out.ok).toBe(true);
    const value = (out as { value: string }).value;
    // End of day, not midnight: a posting set to close on the 10th should be
    // live for all of the 10th rather than expiring as it begins.
    expect(value).toBe(`${day(10)}T23:59:59.999Z`);
  });

  it("refuses a date in the past instead of silently dropping it", () => {
    /*
     * The judgment call, and the difference from presets: a person typed this.
     * Discarding it quietly would show a form that looked like it worked while
     * the posting sat there not expiring, with nothing anywhere saying why.
     */
    const out = readExpiry(form({ expiresIn: "custom", expiresOn: day(-1) }), NOW);
    expect(out.ok).toBe(false);
    expect((out as { error: string }).error).toMatch(/future/i);
  });

  it("refuses beyond the upper bound", () => {
    const out = readExpiry(
      form({ expiresIn: "custom", expiresOn: day(MAX_EXPIRY_DAYS + 1) }),
      NOW,
    );
    expect(out.ok).toBe(false);
    expect((out as { error: string }).error).toMatch(new RegExp(String(MAX_EXPIRY_DAYS)));
  });

  it("accepts the last day inside the bound and refuses the first day outside it", () => {
    // The boundary itself, because an off-by-one here is invisible.
    expect(readExpiry(form({ expiresIn: "custom", expiresOn: day(MAX_EXPIRY_DAYS - 1) }), NOW).ok).toBe(true);
    expect(readExpiry(form({ expiresIn: "custom", expiresOn: day(MAX_EXPIRY_DAYS + 2) }), NOW).ok).toBe(false);
  });

  it("refuses an empty or malformed date rather than coercing it", () => {
    for (const bad of ["", "not-a-date", "31/12/2026", "2026-13-45", "2026-8-1"]) {
      const out = readExpiry(form({ expiresIn: "custom", expiresOn: bad }), NOW);
      expect(out.ok, `"${bad}" was accepted`).toBe(false);
    }
  });

  it("a date is valid through the END of its day, so 'today' works all day", () => {
    /*
     * The normalisation that makes choosing today mean "run it for the rest of
     * today" rather than "already expired". It is also why the past check can
     * be a plain instant comparison: end-of-day today is ahead of any `now`
     * within that day, so today is accepted at 00:01 and at 23:00 alike.
     */
    for (const hour of ["00:01", "12:00", "23:00"]) {
      const at = new Date(`2026-08-31T${hour}:00.000Z`);
      const out = readExpiry(form({ expiresIn: "custom", expiresOn: "2026-08-31" }), at);
      expect(out.ok, `today was refused at ${hour}`).toBe(true);
    }
  });

  it("refuses a day that has fully ended", () => {
    const out = readExpiry(
      form({ expiresIn: "custom", expiresOn: "2026-08-31" }),
      new Date("2026-09-01T00:00:00.000Z"),
    );
    expect(out.ok, "a date whose day has ended was still accepted").toBe(false);
  });
});
