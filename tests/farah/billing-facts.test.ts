/**
 * Billing chips: prices, packs, passes and the user's own balance reach Farah from the SERVER, in a labelled facts block, and from nowhere else. The prompt used to forbid quoting any price; it now allows quoting
 * exactly what the facts block holds. A price the client sends is never read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBillingFacts, MAX_FACTS_CHARS } from "@/lib/farah/billing-facts";
import { CREDIT_PACKS, PASSES } from "@/lib/billing/catalog";
import { CREDIT_COSTS } from "@/lib/credits/costs";
import { AUTO_APPLY_FREE_PER_WEEK } from "@/lib/auto-apply/config";
import { buildFarahChatSystemPrompt } from "@/lib/farah/chat-prompt";
import { FARAH_SYSTEM_PROMPT } from "@/lib/farah/system-prompt";
import { estimateTokens } from "@/lib/farah/token-budget";

const INPUT = { balance: 12, farahFreeAllowance: 3, farahFreeWindowDays: 30, farahFreeLeft: 2 };
const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

describe("buildBillingFacts reads the server's own catalog and the user's own numbers", () => {
  const facts = buildBillingFacts(INPUT);

  it("holds every credit pack with its credits and naira price, from the catalog", () => {
    for (const p of CREDIT_PACKS) expect(facts).toContain(`${p.name}: ${p.credits} credits for ${naira(p.price_ngn)}`);
  });
  it("holds every Pass with its length and naira price, from the catalog", () => {
    for (const p of PASSES) expect(facts).toContain(`${p.name}: ${p.duration_days} days for ${naira(p.price_ngn)}`);
  });
  it("holds the price of every credit-spending action, from the price list", () => {
    expect(facts).toContain(`Tailor a resume: ${CREDIT_COSTS.tailoringRun} credits`);
    expect(facts).toContain(`Cover letter: ${CREDIT_COSTS.coverLetterRun} credits`);
    expect(facts).toContain(`Farah message: ${CREDIT_COSTS.farahChatMessage} credit`);
  });
  it("says what is free and how each allowance renews: weekly, over a rolling 30 days, or one time", () => {
    expect(facts).toContain(`Auto-Apply: ${AUTO_APPLY_FREE_PER_WEEK} confirmed applications a week`);
    expect(facts).toMatch(/Farah: 3 free messages in a rolling 30 days/);
    expect(facts).toMatch(/first resume tailoring run and your first cover letter: free, one time each/);
  });
  it("holds the user's own balance and free messages left", () => {
    expect(facts).toContain("Credit balance: 12 credits");
    expect(facts).toContain("Free Farah messages left: 2");
  });
  it("says a Pass holder has no free-message count to quote (null), and never invents one", () => {
    const pass = buildBillingFacts({ ...INPUT, farahFreeLeft: null });
    expect(pass).toContain("An active Pass covers Farah messages");
    expect(pass).not.toContain("Free Farah messages left:");
  });
  it("is a plain, bounded block: within MAX_FACTS_CHARS", () => {
    expect(facts.length).toBeLessThanOrEqual(MAX_FACTS_CHARS);
  });
});

describe("a repricing moves the facts with it", () => {
  beforeEach(() => vi.resetModules());
  it("with the catalog and price list changed, the facts say the new numbers", async () => {
    vi.doMock("@/lib/billing/catalog", async () => {
      const actual = await vi.importActual<typeof import("@/lib/billing/catalog")>("@/lib/billing/catalog");
      return { ...actual, CREDIT_PACKS: [{ name: "Starter", credits: 33, price_ngn: 4321 }], PASSES: [{ name: "7-Day Sprint Pass", duration_days: 7, price_ngn: 9999 }] };
    });
    vi.doMock("@/lib/credits/costs", async () => {
      const actual = await vi.importActual<typeof import("@/lib/credits/costs")>("@/lib/credits/costs");
      return { ...actual, CREDIT_COSTS: { ...actual.CREDIT_COSTS, tailoringRun: 77 } };
    });
    const { buildBillingFacts: build } = await import("@/lib/farah/billing-facts");
    const f = build(INPUT);
    expect(f).toContain("Starter: 33 credits for ₦4,321");
    expect(f).toContain("7-Day Sprint Pass: 7 days for ₦9,999");
    expect(f).toContain("Tailor a resume: 77 credits");
    vi.doUnmock("@/lib/billing/catalog");
    vi.doUnmock("@/lib/credits/costs");
  });
});

describe("the prompt", () => {
  const facts = buildBillingFacts(INPUT);

  it("no longer forbids quoting a price outright; it allows quoting only what the facts block holds, and says a number in the user's message is not a fact", () => {
    expect(FARAH_SYSTEM_PROMPT).not.toMatch(/don't invent or quote a specific credit price/i);
    expect(FARAH_SYSTEM_PROMPT).toMatch(/platform facts/i);
    expect(FARAH_SYSTEM_PROMPT).toMatch(/not a fact/i);
  });

  it("puts the facts in a labelled block, after the chip's instructions, only when facts are given", () => {
    const withFacts = buildFarahChatSystemPrompt({ quickAction: "billing-pack-or-pass", facts });
    expect(withFacts).toContain("<platform_facts>");
    expect(withFacts).toContain("</platform_facts>");
    expect(withFacts).toContain("Starter: 20 credits for ₦2,500");
    expect(withFacts.indexOf("Billing question")).toBeLessThan(withFacts.indexOf("<platform_facts>"));
    const without = buildFarahChatSystemPrompt({ quickAction: "billing-pack-or-pass" });
    expect(without).not.toContain("<platform_facts>");
    expect(without).not.toContain("₦2,500");
  });

  it("the facts block cannot be closed or forged from inside: facts hold only numbers and catalog names (no user text)", () => {
    expect(facts).not.toMatch(/[<>]/);
  });

  it("how much a billing message adds to the request, in tokens (estimate, chars / 4), stays small", () => {
    const added = estimateTokens(facts);
    expect(added).toBeGreaterThan(50);
    expect(added).toBeLessThanOrEqual(Math.ceil(MAX_FACTS_CHARS / 4));
  });
});
