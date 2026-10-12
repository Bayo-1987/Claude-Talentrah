import { describe, expect, it } from "vitest";
import { validateSlots, MIN_SLOTS, MAX_SLOTS } from "@/lib/interviews/slots-input";

const NOW = new Date("2026-10-10T12:00:00Z");
const slot = (iso: string) => iso;

describe("validateSlots: what the employer offered, checked before the database is asked", () => {
  it("accepts 2 to 5 distinct future times, a length of 15 to 240 minutes, and returns the jsonb the database wants", () => {
    const result = validateSlots({ times: [slot("2026-10-20T09:00:00Z"), slot("2026-10-21T09:00:00Z")], durationMinutes: 45 }, NOW);
    expect(result).toEqual({
      ok: true,
      slots: [
        { starts_at: "2026-10-20T09:00:00.000Z", duration_minutes: 45 },
        { starts_at: "2026-10-21T09:00:00.000Z", duration_minutes: 45 },
      ],
    });
    expect(MIN_SLOTS).toBe(2);
    expect(MAX_SLOTS).toBe(5);
  });

  it("refuses fewer than two or more than five times", () => {
    expect(validateSlots({ times: ["2026-10-20T09:00:00Z"], durationMinutes: 30 }, NOW)).toMatchObject({ ok: false });
    expect(validateSlots({ times: Array.from({ length: 6 }, (_, i) => `2026-10-2${i}T09:00:00Z`), durationMinutes: 30 }, NOW)).toMatchObject({ ok: false });
  });

  it("refuses a duplicate time, a time in the past, a time less than an hour away, and one more than 60 days out", () => {
    expect(validateSlots({ times: ["2026-10-20T09:00:00Z", "2026-10-20T09:00:00Z"], durationMinutes: 30 }, NOW)).toMatchObject({ ok: false });
    expect(validateSlots({ times: ["2026-10-09T09:00:00Z", "2026-10-20T09:00:00Z"], durationMinutes: 30 }, NOW)).toMatchObject({ ok: false });
    expect(validateSlots({ times: ["2026-10-10T12:30:00Z", "2026-10-20T09:00:00Z"], durationMinutes: 30 }, NOW)).toMatchObject({ ok: false });
    expect(validateSlots({ times: ["2026-10-20T09:00:00Z", "2026-12-20T09:00:00Z"], durationMinutes: 30 }, NOW)).toMatchObject({ ok: false });
  });

  it("refuses a length outside 15 to 240 minutes, a non-integer length, and anything that is not an instant", () => {
    for (const d of [14, 241, 0, -5, 30.5, NaN]) expect(validateSlots({ times: ["2026-10-20T09:00:00Z", "2026-10-21T09:00:00Z"], durationMinutes: d }, NOW)).toMatchObject({ ok: false });
    expect(validateSlots({ times: ["2026-10-20T09:00:00Z", "tomorrow at nine"], durationMinutes: 30 }, NOW)).toMatchObject({ ok: false });
    expect(validateSlots({ times: "nope" as unknown as string[], durationMinutes: 30 }, NOW)).toMatchObject({ ok: false });
  });

  it("normalises a time with an offset to UTC, so the database always gets an explicit Z", () => {
    const result = validateSlots({ times: ["2026-10-20T10:00:00+01:00", "2026-10-21T10:00:00+01:00"], durationMinutes: 30 }, NOW);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.slots[0].starts_at).toBe("2026-10-20T09:00:00.000Z");
  });
});
