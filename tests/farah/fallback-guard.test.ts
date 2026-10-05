/**
 * The ceiling is checked again before the fallback provider is used. The fallback may be used only while the headroom (ceiling minus today's estimated spend) covers EVERYTHING the fallback could add in a
 * day: its daily request cap times its worst-case request. With that reserve held back, the fallback can never push the day past the ceiling, so the only overshoot left is the primary provider's own bound.
 *
 *   headroom = ceiling - spent;   fallback allowed  <=>  headroom >= FALLBACK_RESERVE_NANO
 *
 * At the default $1.00 ceiling the reserve is $0.3636, so the fallback is switched off once today's estimate passes $0.6364. A counter that cannot be read means no fallback (fail closed).
 */
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DAILY_CEILING_USD,
  FALLBACK_RESERVE_NANO,
  GEMINI_FALLBACK_REQUESTS_PER_DAY,
  GEMINI_OVERSHOOT_BOUND_NANO,
  GUARDED_OVERSHOOT_BOUND_NANO,
  NANO_PER_USD,
  OVERSHOOT_BOUND_NANO,
  TOTAL_OVERSHOOT_BOUND_NANO,
  checkFallbackHeadroom,
  fallbackAllowed,
} from "@/lib/farah/spend-ceiling";

const CEILING = DEFAULT_DAILY_CEILING_USD * NANO_PER_USD;

describe("the fallback reserve", () => {
  it("is everything the fallback can add in a day: its daily cap times its worst-case request, 363,600,000 nano-dollars ($0.3636)", () => {
    expect(FALLBACK_RESERVE_NANO).toBe(GEMINI_OVERSHOOT_BOUND_NANO);
    expect(FALLBACK_RESERVE_NANO).toBe(GEMINI_FALLBACK_REQUESTS_PER_DAY * 18_180_000);
    expect(FALLBACK_RESERVE_NANO).toBe(363_600_000);
  });
});

describe("fallbackAllowed (pure)", () => {
  it("is allowed with nothing spent", () => expect(fallbackAllowed(0, CEILING)).toBe(true));
  it("is allowed with exactly the reserve left", () => expect(fallbackAllowed(CEILING - FALLBACK_RESERVE_NANO, CEILING)).toBe(true));
  it("is refused with one nano-dollar less than the reserve left", () => expect(fallbackAllowed(CEILING - FALLBACK_RESERVE_NANO + 1, CEILING)).toBe(false));
  it("is refused at and above the ceiling", () => {
    expect(fallbackAllowed(CEILING, CEILING)).toBe(false);
    expect(fallbackAllowed(CEILING * 2, CEILING)).toBe(false);
  });
  it("is never allowed when the ceiling itself is smaller than the reserve", () => expect(fallbackAllowed(0, FALLBACK_RESERVE_NANO - 1)).toBe(false));
  it("at the default ceiling the switch-off point is $0.6364 of today's estimate", () => {
    expect(CEILING - FALLBACK_RESERVE_NANO).toBe(636_400_000);
  });
});

describe("checkFallbackHeadroom (reads today's total, with the environment ceiling)", () => {
  it("reads once and answers from the total", async () => {
    const read = vi.fn().mockResolvedValue(CEILING - FALLBACK_RESERVE_NANO);
    expect(await checkFallbackHeadroom({ read }, {})).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(await checkFallbackHeadroom({ read: async () => CEILING - FALLBACK_RESERVE_NANO + 1 }, {})).toBe(false);
  });
  it("follows the configured ceiling: a $2.00 ceiling allows the fallback at $1.50 of spend, the $1.00 default does not", async () => {
    const read = async () => 1.5 * NANO_PER_USD;
    expect(await checkFallbackHeadroom({ read }, { FARAH_DAILY_SPEND_CEILING_USD: "2" })).toBe(true);
    expect(await checkFallbackHeadroom({ read }, {})).toBe(false);
  });
  it("lets a read failure through to the caller (the failover turns a throw into a no)", async () => {
    await expect(checkFallbackHeadroom({ read: async () => { throw new Error("unreadable"); } }, {})).rejects.toThrow("unreadable");
  });
});

describe("the worst case with and without the guard, at the default ceiling", () => {
  it("without the guard: Groq $0.15 plus the fallback's $0.3636 = $0.5136 (51.36% of $1.00)", () => {
    expect(TOTAL_OVERSHOOT_BOUND_NANO).toBe(OVERSHOOT_BOUND_NANO + GEMINI_OVERSHOOT_BOUND_NANO);
    expect(TOTAL_OVERSHOOT_BOUND_NANO).toBe(513_600_000);
  });
  it("with the guard: only Groq's $0.15 is left (15% of $1.00), inside the 20% target", () => {
    expect(GUARDED_OVERSHOOT_BOUND_NANO).toBe(OVERSHOOT_BOUND_NANO);
    expect(GUARDED_OVERSHOOT_BOUND_NANO).toBe(150_000_000);
    expect(GUARDED_OVERSHOOT_BOUND_NANO / CEILING).toBeLessThanOrEqual(0.2);
    expect(TOTAL_OVERSHOOT_BOUND_NANO / CEILING).toBeGreaterThan(0.2);
  });
  it("why it holds: once the fallback is allowed, spent <= ceiling - reserve, and the fallback's whole daily cap fits inside that reserve, so it cannot add past the ceiling", () => {
    const lastAllowedSpend = CEILING - FALLBACK_RESERVE_NANO;
    expect(lastAllowedSpend + GEMINI_FALLBACK_REQUESTS_PER_DAY * 18_180_000).toBeLessThanOrEqual(CEILING);
  });
});
