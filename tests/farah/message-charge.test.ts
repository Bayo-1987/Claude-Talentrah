/**
 * farahMessageCharge: the ONE function that says what the next Farah message costs this account. checkFarahChatAllowance (the gate that charges) and every label that tells the person a price call it, so a label
 * can never promise a different price from the one the gate takes. The order is the gate's own, confirmed by the founder (0123): free allowance first, then an active Pass, then credits.
 *
 * Pure: no database, no React. The agreement with the real gate is tests/farah/message-charge-agreement.test.ts.
 */
import { describe, expect, it } from "vitest";
import { farahMessageCharge, panelChipCharge, paidMessageCredits } from "@/lib/credits/farah-message-charge";
import { CREDIT_COSTS } from "@/lib/credits/costs";

const COST = CREDIT_COSTS.farahChatMessage;

describe("farahMessageCharge", () => {
  it("free messages left: the message is free, and one fewer is left after it", () => {
    expect(farahMessageCharge({ freeLeft: 3, passCovered: false, balance: 0 })).toEqual({ kind: "free", freeAfter: 2 });
    expect(farahMessageCharge({ freeLeft: 1, passCovered: false, balance: 0 })).toEqual({ kind: "free", freeAfter: 0 });
  });
  it("free comes BEFORE a Pass: a Pass holder with free messages left still uses a free one (the founder's order)", () => {
    expect(farahMessageCharge({ freeLeft: 2, passCovered: true, balance: 50 })).toEqual({ kind: "free", freeAfter: 1 });
  });
  it("no free message left, an active Pass: covered, no credits", () => {
    expect(farahMessageCharge({ freeLeft: 0, passCovered: true, balance: 0 })).toEqual({ kind: "pass" });
  });
  it("no free message left, no Pass, enough credits: the price, from the price list", () => {
    expect(farahMessageCharge({ freeLeft: 0, passCovered: false, balance: COST })).toEqual({ kind: "credits", credits: COST });
    expect(farahMessageCharge({ freeLeft: 0, passCovered: false, balance: 999 })).toEqual({ kind: "credits", credits: COST });
  });
  it("no free message left, no Pass, not enough credits: refused, with what was needed and what there is", () => {
    expect(farahMessageCharge({ freeLeft: 0, passCovered: false, balance: 0 })).toEqual({ kind: "insufficient", required: COST, available: 0 });
    expect(farahMessageCharge({ freeLeft: 0, passCovered: false, balance: COST - 1 })).toEqual({ kind: "insufficient", required: COST, available: COST - 1 });
  });
  it("the free count not known yet: unknown (a chip is disabled, nothing is promised)", () => {
    expect(farahMessageCharge({ freeLeft: undefined, passCovered: false, balance: 10 })).toEqual({ kind: "unknown" });
  });
  it("no free left and whether a Pass covers it not known: unknown", () => {
    expect(farahMessageCharge({ freeLeft: 0, passCovered: undefined, balance: 10 })).toEqual({ kind: "unknown" });
  });
  it("balance not known (the panel has not loaded it): the price is still stated, without a refusal it cannot know about", () => {
    expect(farahMessageCharge({ freeLeft: 0, passCovered: false, balance: undefined })).toEqual({ kind: "credits", credits: COST });
  });
});

describe("panelChipCharge: what the panel knows (the free count from /api/farah/history: a number, null for a Pass holder, undefined until loaded)", () => {
  it("a number above zero is free", () => expect(panelChipCharge(2, 0)).toEqual({ kind: "free", freeAfter: 1 }));
  it("zero with credits is the price", () => expect(panelChipCharge(0, 5)).toEqual({ kind: "credits", credits: COST }));
  it("zero with no credits is a refusal", () => expect(panelChipCharge(0, 0)).toEqual({ kind: "insufficient", required: COST, available: 0 }));
  it("null (an active Pass) is covered", () => expect(panelChipCharge(null, 0)).toEqual({ kind: "pass" }));
  it("undefined (not loaded yet) is unknown", () => expect(panelChipCharge(undefined, 5)).toEqual({ kind: "unknown" }));
});

describe("paidMessageCredits: the price of one paid message, for text that reports a charge after the fact", () => {
  it("is the price from the price list, through the same function the gate uses", () => {
    expect(paidMessageCredits()).toBe(COST);
    expect(paidMessageCredits()).toBe((farahMessageCharge({ freeLeft: 0, passCovered: false, balance: undefined }) as { credits: number }).credits);
  });
});

describe("the gate reads the price from the charge function, not from the price list directly", () => {
  it("chat-gate.ts does not mention CREDIT_COSTS.farahChatMessage", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const gate = readFileSync(join(__dirname, "../../src/lib/farah/chat-gate.ts"), "utf8");
    expect(gate).not.toContain("farahChatMessage");
    expect(gate).toContain("farahMessageCharge");
  });
});

