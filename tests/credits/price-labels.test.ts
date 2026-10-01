/**
 * send-493 (PR B) — the helpers every credit-spending control builds its price text from.
 *
 * The rule under test: a price shown next to a control comes from `CREDIT_COSTS`, never from a number typed
 * into a component. Two ways that rule gets broken, and both are pinned here:
 *   - a label with a literal in it ("· 2 credits"), which keeps showing the old price after a repricing;
 *   - a label that reads the wrong key (tailoringRun where coverLetterRun was meant).
 * The second is caught by swapping the price list for numbers no real price uses and checking each label
 * follows ITS key.
 *
 * The module does not exist when this file is first committed, so it is loaded at runtime (loadModule):
 * `tsc` passes and every test fails on its own assertion instead of the whole job failing to compile.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadModule } from "../support/load-module";
import { CREDIT_COSTS } from "@/lib/credits/costs";

interface Charge {
  kind: "free" | "pass" | "credits";
  credits: number;
}
interface PriceLabels {
  creditsPhrase(n: number): string;
  priceText(opts: { cost: number; passCovered?: boolean }): string;
  withPrice(label: string, price: string): string;
  tailoringCharge(opts: {
    tailoringFree: boolean;
    coverLetterFree: boolean;
    passCovered: boolean;
    includeCoverLetter: boolean;
  }): Charge;
  tailorButtonLabel(charge: Charge, balance: number): string;
  quickActionMode(freeRemaining: number | null | undefined): "send" | "prefill";
  farahAllowanceLine(freeRemaining: number): string;
  chargeAnnouncement(verb: string, credits: number): string;
}

const load = () => loadModule<PriceLabels>("@/lib/credits/price-labels");

afterEach(() => {
  vi.doUnmock("@/lib/credits/costs");
  vi.resetModules();
});

describe("creditsPhrase", () => {
  it("is singular for exactly one and plural otherwise", async () => {
    const { creditsPhrase } = await load();
    expect(creditsPhrase(1)).toBe("1 credit");
    expect(creditsPhrase(2)).toBe("2 credits");
    expect(creditsPhrase(20)).toBe("20 credits");
    expect(creditsPhrase(0)).toBe("0 credits");
  });
});

describe("priceText / withPrice", () => {
  it("shows the credit price, or 'included with your Pass' when a Pass covers the action", async () => {
    const { priceText, withPrice } = await load();
    expect(priceText({ cost: CREDIT_COSTS.bulletRewrite })).toBe("2 credits");
    expect(priceText({ cost: CREDIT_COSTS.bulletRewrite, passCovered: true })).toBe("included with your Pass");
    expect(withPrice("More concise", "2 credits")).toBe("More concise · 2 credits");
  });
});

describe("tailoringCharge — what a run will actually cost this account", () => {
  const base = { tailoringFree: false, coverLetterFree: false, passCovered: false, includeCoverLetter: false };

  it("a paid tailoring run costs tailoringRun", async () => {
    const { tailoringCharge } = await load();
    expect(tailoringCharge(base)).toEqual({ kind: "credits", credits: CREDIT_COSTS.tailoringRun });
  });

  it("a paid run with a paid cover letter costs both", async () => {
    const { tailoringCharge } = await load();
    expect(tailoringCharge({ ...base, includeCoverLetter: true })).toEqual({
      kind: "credits",
      credits: CREDIT_COSTS.tailoringRun + CREDIT_COSTS.coverLetterRun,
    });
  });

  it("the free tailoring run is free, but a cover letter ticked on top of it is still charged", async () => {
    const { tailoringCharge } = await load();
    expect(tailoringCharge({ ...base, tailoringFree: true })).toEqual({ kind: "free", credits: 0 });
    expect(tailoringCharge({ ...base, tailoringFree: true, includeCoverLetter: true })).toEqual({
      kind: "credits",
      credits: CREDIT_COSTS.coverLetterRun,
    });
    expect(tailoringCharge({ ...base, tailoringFree: true, coverLetterFree: true, includeCoverLetter: true })).toEqual({
      kind: "free",
      credits: 0,
    });
  });

  it("a covering Pass wins over everything: nothing is charged and no free run is spent", async () => {
    const { tailoringCharge } = await load();
    expect(tailoringCharge({ ...base, passCovered: true, includeCoverLetter: true })).toEqual({ kind: "pass", credits: 0 });
  });
});

describe("tailorButtonLabel", () => {
  it("names the cost and the current balance on the button", async () => {
    const { tailorButtonLabel } = await load();
    expect(tailorButtonLabel({ kind: "credits", credits: CREDIT_COSTS.tailoringRun }, 38)).toBe(
      `Tailor my resume · ${CREDIT_COSTS.tailoringRun} credits (you have 38)`,
    );
  });

  it("says 'free' only for a run that really is free, and never shows a balance for it", async () => {
    const { tailorButtonLabel } = await load();
    const label = tailorButtonLabel({ kind: "free", credits: 0 }, 38);
    expect(label).toMatch(/free/i);
    expect(label).not.toMatch(/you have/);
  });

  it("says 'included with your Pass' for a covered run", async () => {
    const { tailorButtonLabel } = await load();
    expect(tailorButtonLabel({ kind: "pass", credits: 0 }, 0)).toMatch(/included with your Pass/);
  });
});

describe("quickActionMode — a Farah quick action must never send a charged message by itself", () => {
  it("sends only while free messages remain (or for a Pass holder, whose count is unknown/null)", async () => {
    const { quickActionMode } = await load();
    expect(quickActionMode(3)).toBe("send");
    expect(quickActionMode(1)).toBe("send");
    expect(quickActionMode(null)).toBe("send");
  });

  it("prefills the input, without sending, once the free messages are used up", async () => {
    const { quickActionMode } = await load();
    expect(quickActionMode(0)).toBe("prefill");
  });

  it(
    "prefills while the allowance is still UNKNOWN (undefined: the history fetch has not answered yet) — a click " +
      "in that window must not send what might be a paid message. Found by the e2e, not predicted: it clicked a " +
      "chip straight after page load and the message was sent",
    async () => {
      const { quickActionMode } = await load();
      expect(quickActionMode(undefined)).toBe("prefill");
      // null is KNOWN-and-unrationed (a Pass holder), which is not the same thing as unknown.
      expect(quickActionMode(null)).toBe("send");
    },
  );
});

describe("farahAllowanceLine", () => {
  it("states the real price of a further message once the free ones are gone", async () => {
    const { farahAllowanceLine } = await load();
    expect(farahAllowanceLine(0)).toContain(`${CREDIT_COSTS.farahChatMessage} credit`);
    expect(farahAllowanceLine(2)).toMatch(/2 free messages left/);
    expect(farahAllowanceLine(1)).toMatch(/1 free message left/);
  });
});

describe("chargeAnnouncement — the text for the polite live region", () => {
  it("reports the result and the charge together", async () => {
    const { chargeAnnouncement } = await load();
    expect(chargeAnnouncement("Rewritten", CREDIT_COSTS.bulletRewrite)).toBe("Rewritten — 2 credits used");
    expect(chargeAnnouncement("Rewritten", 1)).toBe("Rewritten — 1 credit used");
    expect(chargeAnnouncement("Rewritten", 0)).toBe("Rewritten — no credits used");
  });
});

describe("every label follows its OWN key in CREDIT_COSTS (no literal, no wrong key)", () => {
  it("with the price list swapped for numbers no real price uses, each label shows the swapped number for its key", async () => {
    vi.resetModules();
    vi.doMock("@/lib/credits/costs", () => ({
      CREDIT_COSTS: {
        tailoringRun: 777,
        coverLetterRun: 333,
        bulletRewrite: 55,
        farahChatMessage: 9,
        autoApplySubmission: 41,
        scholarshipEligibilityCheck: 42,
        scholarshipSopDraft: 43,
        templateUnlock: 44,
        talentDirectoryVerification: 45,
        talentDirectoryHumanReview: 46,
        talentDirectoryBoost: 47,
      },
    }));
    const m = await load();
    const base = { tailoringFree: false, coverLetterFree: false, passCovered: false, includeCoverLetter: false };

    expect(m.tailoringCharge(base).credits).toBe(777);
    expect(m.tailoringCharge({ ...base, includeCoverLetter: true }).credits).toBe(777 + 333);
    expect(m.tailorButtonLabel(m.tailoringCharge(base), 1000)).toContain("777 credits");
    expect(m.farahAllowanceLine(0)).toContain("9 credits");
  });
});
