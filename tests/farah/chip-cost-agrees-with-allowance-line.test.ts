/**
 * The chip's cost label (before the click) and the allowance line under the greeting are two sentences about the same thing, and they read the same inputs (the free messages left, the balance). They must never
 * disagree: a chip that says "free" under a line that says "each message costs 1 credit" would be a charge nobody warned about. Per charge kind: the label comes from the one charge function the gate also uses
 * (farah-message-charge.ts); the line from farahAllowanceText. Table-driven over every state the panel can be in.
 */
import { describe, expect, it } from "vitest";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { panelChipCharge } from "@/lib/credits/farah-message-charge";
import { creditsPhrase, farahAllowanceText, farahChipCostLabel } from "@/lib/credits/price-labels";

const PRICE = creditsPhrase(CREDIT_COSTS.farahChatMessage);
const NOW = new Date("2026-10-07T12:00:00Z");
const line = (freeRemaining: number | null | undefined) => farahAllowanceText({ freeRemaining, nextFreeMessageAt: null, now: NOW, timeZone: "UTC" })?.text ?? null;
const label = (freeRemaining: number | null | undefined, balance?: number) => farahChipCostLabel(panelChipCharge(freeRemaining, balance));

describe("the chip's cost label and the allowance line agree, state by state", () => {
  it("free messages left: the line counts them and the chip says free", () => {
    for (const n of [1, 2, 3]) {
      expect(line(n), `${n} left`).toContain(`${n} free message`);
      expect(label(n, 0), `${n} left`).toBe("free");
      expect(label(n, 9), `${n} left, with credits`).toBe("free");
    }
  });

  it("none left, enough credits: BOTH state the same price, and neither says free", () => {
    expect(line(0)).toContain(PRICE);
    expect(label(0, 10)).toBe(PRICE);
    expect(line(0)).not.toMatch(/\bfree message\b(?! is)/);
    expect(label(0, 10)).not.toBe("free");
  });

  it("none left, not enough credits: both state the same price; the chip adds what the person has", () => {
    expect(line(0)).toContain(PRICE);
    expect(label(0, 0)).toBe(`${PRICE} (you have 0)`);
    expect(label(0, 0)).toContain(PRICE);
  });

  it("an active Pass: the line is silent and the chip says included, never a price", () => {
    expect(line(null)).toBeNull();
    expect(label(null, 0)).toBe("included with your Pass");
    expect(label(null, 5)).toBe("included with your Pass");
    expect(label(null, 0)).not.toContain("credit");
  });

  it("count not known yet: BOTH say nothing (the chips are disabled for that moment)", () => {
    expect(line(undefined)).toBeNull();
    expect(label(undefined, 5)).toBeNull();
    expect(label(undefined, undefined)).toBeNull();
  });

  it("the price both sentences quote is the gate's: CREDIT_COSTS.farahChatMessage, through the same phrase function", () => {
    expect(PRICE).toBe(creditsPhrase(CREDIT_COSTS.farahChatMessage));
    expect(label(0, 10)).toBe(creditsPhrase(CREDIT_COSTS.farahChatMessage));
  });
});
