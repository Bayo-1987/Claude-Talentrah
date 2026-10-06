/**
 * The gate that charges and the charge function (what every price label calls) agree. For each state an account can be in, checkFarahChatAllowance (with its database reads faked at the module boundary) is run, and the same facts go through
 * the function the labels use; both must name the same outcome and the same price. A second test re-prices the whole list and checks both move together.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { used: 0, balance: 0, passCovered: false, passReason: "no_active_pass" as "no_active_pass" | "daily_cap_reached" };

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
// The free-message claim (migration 0236) is asked for only when the read says a free message is left; here it grants one (and counts the pending ones as `claimedElsewhere`).
const claim = { claimedElsewhere: 0 };
const rpcCalls: string[] = [];
const rpc = async (fn: string) => {
  rpcCalls.push(fn);
  if (fn !== "claim_farah_free_message") return { data: true, error: null };
  const used = state.used + claim.claimedElsewhere;
  return used < 3 ? { data: [{ ok: true, claim_id: "claim-1", used: used + 1 }], error: null } : { data: [{ ok: false, claim_id: null, used }], error: null };
};
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ from, rpc }) }));
vi.mock("@/lib/passes/entitlement", () => ({
  checkPassCoverage: async () => (state.passCovered ? { covered: true } : { covered: false, reason: state.passReason }),
  DAILY_CAP_MESSAGE: "cap",
}));
const logCreditGateEvent = vi.fn(async () => undefined);
vi.mock("@/lib/credits/gate-events", () => ({ logCreditGateEvent }));
vi.mock("@/lib/credits/spend", () => ({
  spendCredits: async () => ({ balanceAfter: 0 }),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {
    constructor(public required: number, public available: number, public capMessage?: string) {
      super("insufficient");
    }
  },
}));

const { checkFarahChatAllowance, commitFarahChatAllowance, InsufficientCreditsError } = await import("@/lib/farah/chat-gate");
const { farahMessageCharge, panelChipCharge } = await import("@/lib/credits/farah-message-charge");
const { CREDIT_COSTS } = await import("@/lib/credits/costs");

beforeEach(() => {
  logCreditGateEvent.mockClear();
  state.used = 0;
  state.balance = 0;
  state.passCovered = false;
  state.passReason = "no_active_pass";
  claim.claimedElsewhere = 0;
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

describe("every state an account can be in: the gate and the charge function agree", () => {
  const COST = CREDIT_COSTS.farahChatMessage;
  const FREE_ALLOWANCE = 3;

  it("free messages left: all three counts (3, 2 and 1 left before it)", async () => {
    for (const used of [0, 1, 2]) {
      state.used = used;
      state.balance = 0;
      const left = FREE_ALLOWANCE - used;
      expect(await gateOutcome(), `${used} used`).toEqual({ kind: "free", freeAfter: left - 1 });
      expect(panelFor(used, false, 0), `${used} used`).toEqual({ kind: "free", freeAfter: left - 1 });
    }
  });

  it("free messages used up, no Pass, enough credits: exactly the price, at the boundary and above it", async () => {
    for (const balance of [COST, COST + 1, 50]) {
      state.used = 3;
      state.balance = balance;
      expect(await gateOutcome(), `balance ${balance}`).toEqual({ kind: "credits", credits: COST });
      expect(panelFor(3, false, balance), `balance ${balance}`).toEqual({ kind: "credits", credits: COST });
    }
  });

  it("free messages used up, no Pass, NOT enough credits: refused, at one credit short and at zero", async () => {
    for (const balance of [COST - 1, 0]) {
      state.used = 3;
      state.balance = balance;
      expect(await gateOutcome(), `balance ${balance}`).toEqual({ kind: "insufficient", required: COST, available: balance });
      expect(panelFor(3, false, balance), `balance ${balance}`).toEqual({ kind: "insufficient", required: COST, available: balance });
    }
  });

  it("an active Pass, free messages used up: covered, whatever the balance", async () => {
    for (const balance of [0, 5]) {
      state.used = 3;
      state.passCovered = true;
      state.balance = balance;
      expect(await gateOutcome(), `balance ${balance}`).toEqual({ kind: "pass" });
      expect(panelFor(3, true, balance), `balance ${balance}`).toEqual({ kind: "pass" });
    }
  });

  it("an active Pass but free messages still left: the free message goes first (the founder's order), the Pass is not used", async () => {
    state.used = 1;
    state.passCovered = true;
    state.balance = 0;
    expect(await gateOutcome()).toEqual({ kind: "free", freeAfter: 1 });
  });

  it("an EXPIRED Pass (the Pass check answers 'not covered: no_active_pass', as for no Pass at all): the credit price applies", async () => {
    state.used = 3;
    state.passCovered = false;
    state.passReason = "no_active_pass";
    state.balance = 5;
    expect(await gateOutcome()).toEqual({ kind: "credits", credits: COST });
    state.balance = 0;
    expect(await gateOutcome()).toEqual({ kind: "insufficient", required: COST, available: 0 });
  });

  it("an active Pass past today's fair-use cap: the credit price applies, and a refusal carries the cap's own explanation", async () => {
    state.used = 3;
    state.passCovered = false;
    state.passReason = "daily_cap_reached";
    state.balance = 5;
    expect(await gateOutcome()).toEqual({ kind: "credits", credits: COST });
    state.balance = 0;
    try {
      await checkFarahChatAllowance("u-1");
      throw new Error("expected a refusal");
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientCreditsError);
      expect((e as { capMessage?: string }).capMessage).toBe("cap");
    }
  });

  it("an account with no Pass and no credits is refused WITHOUT a cap message (the cap's explanation belongs to a Pass holder only)", async () => {
    state.used = 3;
    state.balance = 0;
    try {
      await checkFarahChatAllowance("u-1");
      throw new Error("expected a refusal");
    } catch (e) {
      expect((e as { capMessage?: string }).capMessage).toBeUndefined();
    }
  });
});

describe("a message that fails writes nothing: no free message used, so the next-free time cannot move", () => {
  it("checking a free message logs NOTHING (the free-allowance event, which is what the next-free time is read from, is written only by the commit after a successful reply)", async () => {
    state.used = 2;
    const a = await checkFarahChatAllowance("u-1");
    expect(a.isFreeAllowance).toBe(true);
    expect(logCreditGateEvent).not.toHaveBeenCalled();
  });

  it("committing it makes exactly one covered_by_free_allowance event: in the database, from the claim (the app writes none of its own)", async () => {
    state.used = 2;
    rpcCalls.length = 0;
    const a = await checkFarahChatAllowance("u-1");
    await commitFarahChatAllowance("u-1", a);
    expect(rpcCalls.filter((c) => c === "commit_farah_free_claim")).toHaveLength(1);
    expect(logCreditGateEvent).not.toHaveBeenCalled();
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

describe("a request that loses the free-message claim is priced exactly as an account whose free messages are used up", () => {
  const COST = CREDIT_COSTS.farahChatMessage;
  it("1 used on the read but 2 others in flight: the claim is refused, so the gate names the same charge as 3 used (credits, a Pass, or a refusal)", async () => {
    for (const [balance, passCovered] of [[5, false], [0, false], [0, true]] as const) {
      state.used = 1;
      claim.claimedElsewhere = 2;
      state.balance = balance;
      state.passCovered = passCovered;
      const gate = await gateOutcome();
      const chip = panelFor(3, passCovered, balance);
      expect(gate, `balance ${balance} pass ${passCovered}`).toEqual(chip.kind === "credits" ? { kind: "credits", credits: COST } : chip.kind === "pass" ? { kind: "pass" } : { kind: "insufficient", required: COST, available: balance });
    }
  });
});
