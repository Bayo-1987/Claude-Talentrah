/**
 * currentApplicationCycle — the year-stamp scholarship landing pages carry
 * in their title/description ("...2026/2027"), computed from the current
 * date rather than hardcoded so it advances on its own every cycle.
 */
import { describe, expect, it } from "vitest";
import { currentApplicationCycle } from "@/lib/seo/landing-pages";

describe("currentApplicationCycle", () => {
  it("before July, the cycle is last September's — one year back", () => {
    expect(currentApplicationCycle(new Date("2026-01-15T00:00:00Z"))).toBe("2025/2026");
    expect(currentApplicationCycle(new Date("2026-06-30T23:59:59Z"))).toBe("2025/2026");
  });

  it("from July onward, the cycle rolls forward to this September's", () => {
    expect(currentApplicationCycle(new Date("2026-07-01T00:00:00Z"))).toBe("2026/2027");
    expect(currentApplicationCycle(new Date("2026-09-02T00:00:00Z"))).toBe("2026/2027");
    expect(currentApplicationCycle(new Date("2026-12-31T23:59:59Z"))).toBe("2026/2027");
  });

  it("rolls over a calendar year boundary correctly", () => {
    expect(currentApplicationCycle(new Date("2026-12-31T23:59:59Z"))).toBe("2026/2027");
    expect(currentApplicationCycle(new Date("2027-01-01T00:00:00Z"))).toBe("2026/2027");
  });

  it("defaults to the real current date when none is passed", () => {
    // Not asserting a specific value (that would hardcode today's date into
    // the test) — just that it runs and returns the right shape.
    expect(currentApplicationCycle()).toMatch(/^\d{4}\/\d{4}$/);
  });
});
