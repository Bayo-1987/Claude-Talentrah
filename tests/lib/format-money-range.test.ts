/**
 * formatMoneyRange — the one place a pair of money bounds becomes words (S1-26 item 8).
 *
 * The bug it ends: /mentorship told a visitor "sessions currently range from ₦20,000 to ₦20,000". With one approved mentor the
 * minimum equals the maximum, so the "range" is the same number twice and reads as broken. The rules:
 *   - equal bounds: one amount ("₦20,000 per session"), never a range;
 *   - different bounds: "from ₦X to ₦Y";
 *   - nothing to show: null, so the caller leaves the sentence out entirely.
 * It keeps each range's OWN currency (USD, EUR, ...), and the ₦ stays inside one string, next to its digits.
 */
import { describe, expect, it } from "vitest";
import { formatMoneyRange } from "@/lib/format-money-range";

describe("formatMoneyRange: equal bounds", () => {
  it("shows one amount, with the caller's noun", () => {
    expect(formatMoneyRange(20000, 20000, "NGN", { unit: "per session" })).toBe("₦20,000 per session");
  });
  it("shows one amount with no noun when none is given", () => {
    expect(formatMoneyRange(20000, 20000, "NGN")).toBe("₦20,000");
  });
  it("never prints the same figure twice, in any currency", () => {
    for (const currency of ["NGN", "USD", "EUR", "GBP", "GHS", "KES", "ZAR", "CAD"]) {
      const text = formatMoneyRange(90000, 90000, currency)!;
      expect(text.match(/90,000/g), `${currency}: ${text}`).toHaveLength(1);
      expect(text).not.toMatch(/\bto\b|–/);
    }
  });
});

describe("formatMoneyRange: different bounds", () => {
  it("reads 'from X to Y'", () => {
    expect(formatMoneyRange(15000, 20000, "NGN")).toBe("from ₦15,000 to ₦20,000");
    expect(formatMoneyRange(15000, 20000, "NGN", { unit: "per session" })).toBe("from ₦15,000 to ₦20,000 per session");
  });
  it("puts the smaller bound first even if they arrive swapped", () => {
    expect(formatMoneyRange(20000, 15000, "NGN")).toBe("from ₦15,000 to ₦20,000");
  });
  it("keeps the range's own currency: USD stays USD, EUR stays EUR, never ₦", () => {
    expect(formatMoneyRange(60000, 90000, "USD", { unit: "per year" })).toBe("from US$60,000 to US$90,000 per year");
    expect(formatMoneyRange(60000, 90000, "EUR")).toBe("from €60,000 to €90,000");
    expect(formatMoneyRange(90000, 90000, "USD", { unit: "per year" })).toBe("US$90,000 per year");
    expect(formatMoneyRange(60000, 90000, "USD")).not.toContain("₦");
  });
  it("keeps the ₦ and its digits in one string, so the font fallback and the ratchet see an ordinary text node", () => {
    expect(formatMoneyRange(15000, 20000, "NGN")).toContain("₦15,000");
    expect(formatMoneyRange(20000, 20000, "NGN")).toContain("₦20,000");
  });
});

describe("formatMoneyRange: one bound, or none", () => {
  it("one bound is 'from X' or 'up to X'", () => {
    expect(formatMoneyRange(500000, undefined, "NGN")).toBe("from ₦500,000");
    expect(formatMoneyRange(null, 800000, "NGN")).toBe("up to ₦800,000");
  });
  it("no usable bound is null, so the caller can omit the sentence", () => {
    expect(formatMoneyRange(null, null, "NGN")).toBeNull();
    expect(formatMoneyRange(undefined, undefined, "NGN")).toBeNull();
    expect(formatMoneyRange(Number.NaN, Number.NaN, "NGN")).toBeNull();
  });
  it("a currency Intl cannot format is null, never a half-formatted number", () => {
    expect(formatMoneyRange(1, 2, "xx")).toBeNull();
  });
  it("numeric strings (PostgREST returns numeric columns as strings) are read as numbers", () => {
    expect(formatMoneyRange("90000", "90000", "USD")).toBe("US$90,000");
  });
});

describe("formatMoneyRange: the compact style job salaries use", () => {
  it("is 'X – Y', 'X' when equal, 'From X', 'Up to X'", () => {
    expect(formatMoneyRange(500000, 800000, "NGN", { style: "compact", unit: "per month" })).toBe("₦500,000 – ₦800,000 per month");
    expect(formatMoneyRange(90000, 90000, "USD", { style: "compact" })).toBe("US$90,000");
    expect(formatMoneyRange(500000, undefined, "NGN", { style: "compact" })).toBe("From ₦500,000");
    expect(formatMoneyRange(undefined, 800000, "NGN", { style: "compact" })).toBe("Up to ₦800,000");
  });
});
