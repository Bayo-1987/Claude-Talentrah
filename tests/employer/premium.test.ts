import { describe, expect, it } from "vitest";
import { isPremiumUntil } from "@/lib/employer/premium";

const now = new Date("2026-10-10T12:00:00Z");

describe("isPremiumUntil: Premium is a date in the future, nothing else", () => {
  it("no date is not Premium", () => {
    expect(isPremiumUntil(null, now)).toBe(false);
    expect(isPremiumUntil(undefined, now)).toBe(false);
    expect(isPremiumUntil("", now)).toBe(false);
  });
  it("a future date is Premium, a past date is not, and the instant itself is not (it has ended)", () => {
    expect(isPremiumUntil("2026-10-10T12:00:01Z", now)).toBe(true);
    expect(isPremiumUntil("2026-10-10T12:00:00Z", now)).toBe(false);
    expect(isPremiumUntil("2026-10-09T12:00:00Z", now)).toBe(false);
  });
  it("an unreadable date fails closed", () => {
    expect(isPremiumUntil("not a date", now)).toBe(false);
  });
});
