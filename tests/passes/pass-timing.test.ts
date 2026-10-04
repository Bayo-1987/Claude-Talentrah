/**
 * The billing page's "N days left" must be the number the masthead chip shows for the same pass. The chip's number comes from
 * getActivePass (src/lib/passes/entitlement.ts), so this runs the REAL getActivePass over a stubbed service-role client and compares.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const row = vi.hoisted(() => ({ expires_at: "" }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = new Proxy({}, { get: (_t, p) => (p === "maybeSingle" ? async () => ({ data: { expires_at: row.expires_at, passes: { name: "30-Day Pass" } }, error: null }) : () => chain) });
      return chain;
    },
  }),
}));

import { getActivePass } from "@/lib/passes/entitlement";
import { DAY_MS, daysLeft, passTiming, perDayNgn } from "@/lib/passes/pass-timing";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("daysLeft", () => {
  it("equals getActivePass's daysRemaining for the same pass, across whole days, part days and the last hour", async () => {
    let i = 0;
    for (const offset of [DAY_MS * 18, DAY_MS * 18 + 1, DAY_MS * 18 - 1, DAY_MS * 7, 60 * 60 * 1000, 1, DAY_MS * 89 + 5_000]) {
      row.expires_at = new Date(NOW + offset).toISOString();
      const chip = await getActivePass(`user-${i++}`);
      expect(chip, `offset ${offset}`).not.toBeNull();
      expect(daysLeft(row.expires_at, NOW), `offset ${offset}`).toBe(chip!.daysRemaining);
    }
  });

  it("is never negative once a pass has ended", () => {
    expect(daysLeft(new Date(NOW - 5 * DAY_MS).toISOString(), NOW)).toBe(0);
  });
});

describe("passTiming", () => {
  it("a 30-day pass 12 days in has 18 left and 12 used", () => {
    const started = new Date(NOW - 12 * DAY_MS).toISOString();
    const expires = new Date(NOW + 18 * DAY_MS).toISOString();
    expect(passTiming(started, expires, NOW)).toEqual({ totalDays: 30, daysLeft: 18, daysUsed: 12 });
  });

  it("used plus left is always the total, and neither leaves the range", () => {
    const started = new Date(NOW - 400 * DAY_MS).toISOString();
    const expires = new Date(NOW + 5 * DAY_MS).toISOString();
    const t = passTiming(started, expires, NOW);
    expect(t.daysUsed + t.daysLeft).toBe(t.totalDays);
    expect(t.daysUsed).toBeGreaterThanOrEqual(0);
    const brandNew = passTiming(new Date(NOW + DAY_MS).toISOString(), new Date(NOW + 8 * DAY_MS).toISOString(), NOW);
    expect(brandNew.daysUsed).toBeGreaterThanOrEqual(0);
  });
});

describe("perDayNgn", () => {
  it("plain division to the nearest naira: 929, 450, 333 for the three passes", () => {
    expect(perDayNgn(6500, 7)).toBe(929);
    expect(perDayNgn(13500, 30)).toBe(450);
    expect(perDayNgn(30000, 90)).toBe(333);
  });
});
