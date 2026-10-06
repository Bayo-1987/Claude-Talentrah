/**
 * The gate that charges and the charge function (what every price label calls) agree. For each state an account can be in, checkFarahChatAllowance (with its database reads faked at the module boundary) is run, and the same facts go through
 * the function the labels use; both must name the same outcome and the same price. A second test re-prices the whole list and checks both move together.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { used: 0, balance: 0, passCovered: false };

function from(table: string) {
  if (table === "profiles") {
    const c: Record<string, unknown> = { select: () => c, eq: () => c, single: async () => ({ data: { credits_balance: state.balance } }) };
    return c;
  }
  // credit_gate_events: the free-allowance count
  const r = { count: state.used, error: null };
  const c: Record<string, unknown> = { select: () => c, eq: () => c, gte: () => c, then: (resolve: (v: unknown) => void) => resolve(r) };
  return c;
}
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ from }) }));
vi.mock("@/lib/passes/entitlement", () => ({
  checkPassCoverage: async () => (state.passCovered ? { covered: true } : { covered: false, reason: "no_pass" }),
  DAILY_CAP_MESSAGE: "cap",
}));
vi.mock("@/lib/credits/gate-events", () => ({ logCreditGateEvent: async () => undefined }));
vi.mock("@/lib/credits/spend", () => ({
  spendCredits: async () => ({ balanceAfter: 0 }),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {
    constructor(public required: number, public available: number, public capMessage?: string) {
      super("insufficient");
    }
  },
}));

const { checkFarahChatAllowance, InsufficientCreditsError } = await import("@/lib/farah/chat-gate");
const { farahMessageCharge, panelChipCharge } = await import("@/lib/credits/farah-message-charge");
const { CREDIT_COSTS } = await import("@/lib/credits/costs");

beforeEach(() => {
  state.used = 0;
  state.balance = 0;
  state.passCovered = false;
});

/** What the gate decided, in the same words as a charge. */
async function gateOutcome(): Promise<{ kind: string; credits?: number; freeAfter?: number; required?: number; available?: number }> {
  try {
    const a = await checkFarahChatAllowance("u-1");
    if (a.isFreeAllowance) return { kind: "free", freeAfter: a.freeMessagesRemaining ?? undefined };
    if (a.isPassCovered) return { kind: "pass" };
    return { kind: "credits", credits: a.creditsSpent };
  } catch (e) {
    if (e instanceof InsufficientCreditsError) return { kind: "insufficient", required: (e as { required: number }).required, available: (e as { available: number }).available };
    throw e;
  }
}
/** The facts the panel would hold for the same account, in the panel's own terms. */
const panelFor = (used: number, passCovered: boolean, balance: number) => panelChipCharge(passCovered ? null : Math.max(0, 3 - used), balance);

describe("the gate and the charge function name the same charge", () => {
  it("free messages left", async () => {
    state.used = 1;
    state.balance = 0;
    const gate = await gateOutcome();
    const chip = panelFor(1, false, 0);
    expect(gate).toEqual({ kind: "free", freeAfter: 1 });
    expect(chip).toEqual({ kind: "free", freeAfter: 1 });
  });

  it("no free message left, with credits", async () => {
    state.used = 3;
    state.balance = 5;
    const gate = await gateOutcome();
    const chip = panelFor(3, false, 5);
    expect(gate).toEqual({ kind: "credits", credits: CREDIT_COSTS.farahChatMessage });
    expect(chip).toEqual({ kind: "credits", credits: CREDIT_COSTS.farahChatMessage });
  });

  it("no free message left, no credits", async () => {
    state.used = 3;
    state.balance = 0;
    const gate = await gateOutcome();
    const chip = panelFor(3, false, 0);
    expect(gate).toEqual({ kind: "insufficient", required: CREDIT_COSTS.farahChatMessage, available: 0 });
    expect(chip).toEqual({ kind: "insufficient", required: CREDIT_COSTS.farahChatMessage, available: 0 });
  });

  it("an active Pass", async () => {
    state.used = 3;
    state.passCovered = true;
    state.balance = 0;
    const gate = await gateOutcome();
    const chip = panelFor(3, true, 0);
    expect(gate).toEqual({ kind: "pass" });
    expect(chip).toEqual({ kind: "pass" });
  });

  it("the count not known yet: the panel's charge is unknown, and the function says so (the gate always knows, so it is not compared)", () => {
    const chip = panelChipCharge(undefined, 5);
    expect(chip).toEqual({ kind: "unknown" });
    expect(farahMessageCharge({ freeLeft: undefined, passCovered: undefined, balance: undefined })).toEqual({ kind: "unknown" });
  });
});

describe("a repricing moves the gate and the charge function together", () => {
  it("at a price of 7 credits both say 7", async () => {
    vi.resetModules();
    vi.doMock("@/lib/credits/costs", async () => {
      const actual = await vi.importActual<typeof import("@/lib/credits/costs")>("@/lib/credits/costs");
      return { ...actual, CREDIT_COSTS: { ...actual.CREDIT_COSTS, farahChatMessage: 7 } };
    });
    const gate = await import("@/lib/farah/chat-gate");
    const fn = await import("@/lib/credits/farah-message-charge");
    state.used = 3;
    state.balance = 20;
    const a = await gate.checkFarahChatAllowance("u-1");
    const chip = fn.panelChipCharge(0, 20);
    expect(a.creditsSpent).toBe(7);
    expect(chip).toEqual({ kind: "credits", credits: 7 });
    vi.doUnmock("@/lib/credits/costs");
    vi.resetModules();
  });
});
