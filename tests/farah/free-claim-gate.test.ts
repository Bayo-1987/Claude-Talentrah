/**
 * The free-message claim at the gate (migration 0236), with the database faked at its edge. The claim is taken in checkFarahChatAllowance BEFORE the model call, committed in
 * commitFarahChatAllowance after a successful reply, and released in releaseFarahChatAllowance when the reply does not complete. These tests pin what each does with what the three functions answer;
 * the functions themselves are tested against the real database in tests/farah/free-claim.test.ts (CI only) and by the model in tests/farah/free-claim-race-detection.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CREDIT_COSTS } from "@/lib/credits/costs";

import { realRpcBuilder, rejectingRpcBuilder, type RpcAnswer } from "./support/real-rpc-builder";
let rpcRejects = false;
const rpcCalls: Array<[string, Record<string, unknown>]> = [];
let committedFreeCount = 0;
let balance = 5;
let claimAnswer: RpcAnswer = { data: [{ ok: true, claim_id: "claim-1", used: 3 }], error: null };
let commitAnswer: RpcAnswer = { data: true, error: null };
let releaseAnswer: RpcAnswer = { data: true, error: null };
const checkPassCoverage = vi.fn();
const logCreditGateEvent = vi.fn();
const spendCredits = vi.fn();

function chain(result: unknown) {
  const p: object = new Proxy({}, { get: (_t, prop) => (prop === "then" ? (resolve: (v: unknown) => void) => resolve(result) : prop === "single" || prop === "maybeSingle" ? async () => result : () => p) });
  return p;
}
const fakeClient = () => ({
  from: (table: string) => (table === "profiles" ? chain({ data: { credits_balance: balance }, error: null }) : chain({ count: committedFreeCount, data: [], error: null })),
  // a thenable without .catch, as the real client returns (tests/farah/support/real-rpc-builder.ts)
  rpc: (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push([fn, args]);
    if (rpcRejects) return rejectingRpcBuilder(new Error("network down"));
    return realRpcBuilder<RpcAnswer>(fn === "claim_farah_free_message" ? claimAnswer : fn === "commit_farah_free_claim" ? commitAnswer : releaseAnswer);
  },
});
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => fakeClient() }));
vi.mock("@/lib/passes/entitlement", () => ({ checkPassCoverage, DAILY_CAP_MESSAGE: "cap message" }));
vi.mock("@/lib/credits/gate-events", () => ({ logCreditGateEvent }));
vi.mock("@/lib/credits/spend", () => ({
  spendCredits,
  InsufficientCreditsError: class InsufficientCreditsError extends Error {
    constructor(public required: number, public available: number, public capMessage?: string) {
      super("insufficient");
    }
  },
}));
const gate = await import("@/lib/farah/chat-gate");
const COST = CREDIT_COSTS.farahChatMessage;

let errorSpy: ReturnType<typeof vi.spyOn>;
const errorLines = (): string[] => (errorSpy.mock.calls as unknown[][]).map((c) => String(c[0]));
const claimCalls = () => rpcCalls.filter(([fn]) => fn === "claim_farah_free_message");

beforeEach(() => {
  rpcCalls.length = 0;
  rpcRejects = false;
  committedFreeCount = 1; // one used of 3: the read says a free message is left
  balance = 5;
  claimAnswer = { data: [{ ok: true, claim_id: "claim-1", used: 2 }], error: null };
  commitAnswer = { data: true, error: null };
  releaseAnswer = { data: true, error: null };
  checkPassCoverage.mockReset().mockResolvedValue({ covered: false, reason: "no_pass" });
  logCreditGateEvent.mockReset().mockResolvedValue(undefined);
  spendCredits.mockReset().mockResolvedValue(4);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  errorSpy.mockClear(); // spyOn on an already spied method returns the same spy, so the previous test's lines would otherwise still be in it
});

describe("checkFarahChatAllowance: a free message is CLAIMED before the model call", () => {
  it("a free message left on the read: the claim is asked for, with the account, the allowance (3), the window (30 days) and the hold (120 s), and its id travels with the result", async () => {
    const a = await gate.checkFarahChatAllowance("user-1");
    expect(claimCalls()).toEqual([["claim_farah_free_message", { p_user_id: "user-1", p_allowance: 3, p_window_days: 30, p_hold_seconds: 120 }]]);
    expect(a).toMatchObject({ isFreeAllowance: true, isPassCovered: false, creditsSpent: 0, freeClaimId: "claim-1", freeMessagesRemaining: 1 });
  });

  it("the free messages left AFTER this one come from the claim's own count (it includes pending claims), not from the earlier read", async () => {
    committedFreeCount = 0; // the read said 3 left
    claimAnswer = { data: [{ ok: true, claim_id: "claim-9", used: 3 }], error: null }; // but two others are in flight: this one is the third
    const a = await gate.checkFarahChatAllowance("user-1");
    expect(a.freeMessagesRemaining).toBe(0);
  });

  it("nothing is written at check time: no gate event, no spend", async () => {
    await gate.checkFarahChatAllowance("user-1");
    expect(logCreditGateEvent).not.toHaveBeenCalled();
    expect(spendCredits).not.toHaveBeenCalled();
  });

  it("no free message left on the read: the claim is not even asked for", async () => {
    committedFreeCount = 3;
    await gate.checkFarahChatAllowance("user-1");
    expect(claimCalls()).toHaveLength(0);
  });
});

describe("a request that LOSES the claim falls through exactly as if the free messages were already used", () => {
  beforeEach(() => {
    claimAnswer = { data: [{ ok: false, claim_id: null, used: 3 }], error: null };
  });

  it("with credits: it is a credit message, logged as 'proceeded', with no claim id", async () => {
    const a = await gate.checkFarahChatAllowance("user-1");
    expect(a).toMatchObject({ isFreeAllowance: false, isPassCovered: false, creditsSpent: COST, freeMessagesRemaining: 0 });
    expect(a.freeClaimId).toBeUndefined();
    expect(logCreditGateEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: "proceeded", creditsRequired: COST, creditsAvailable: 5 }));
  });

  it("with an active Pass: it is Pass-covered", async () => {
    checkPassCoverage.mockResolvedValue({ covered: true });
    const a = await gate.checkFarahChatAllowance("user-1");
    expect(a).toMatchObject({ isFreeAllowance: false, isPassCovered: true, freeMessagesRemaining: null });
  });

  it("with no Pass and too few credits: refused with the SAME error as when the free messages were simply used up", async () => {
    balance = 0;
    const lost = await gate.checkFarahChatAllowance("user-1").catch((e) => e);
    committedFreeCount = 3;
    claimAnswer = { data: [{ ok: true, claim_id: "unused", used: 1 }], error: null };
    const exhausted = await gate.checkFarahChatAllowance("user-1").catch((e) => e);
    expect(lost).toBeInstanceOf(gate.InsufficientCreditsError);
    expect({ required: lost.required, available: lost.available, cap: lost.capMessage }).toEqual({ required: exhausted.required, available: exhausted.available, cap: exhausted.capMessage });
    expect(logCreditGateEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: "blocked_insufficient_credits" }));
  });
});

describe("a claim that cannot be made is treated as lost (fail closed), with one content-free line", () => {
  it("a database error: the request is not free, nothing in the log names the account or the error text", async () => {
    claimAnswer = { data: null, error: { message: "connection to host db-internal-7 refused", code: "08006" } };
    const a = await gate.checkFarahChatAllowance("user-secret-id");
    expect(a).toMatchObject({ isFreeAllowance: false, creditsSpent: COST });
    expect(errorLines().filter((l) => l.startsWith("[farah-chat-gate] free claim failed"))).toEqual(["[farah-chat-gate] free claim failed (code=08006)"]);
    expect(errorLines().join("\n")).not.toMatch(/user-secret-id|db-internal-7|refused/);
  });

  it("a claim whose call REJECTS (a lost connection) is lost too, with the same content-free line (code=thrown)", async () => {
    rpcRejects = true;
    const a = await gate.checkFarahChatAllowance("user-secret-id");
    expect(a).toMatchObject({ isFreeAllowance: false, creditsSpent: COST });
    expect(errorLines().filter((l) => l.startsWith("[farah-chat-gate] free claim failed"))).toEqual(["[farah-chat-gate] free claim failed (code=thrown)"]);
    expect(errorLines().join("\n")).not.toMatch(/user-secret-id|network down/);
  });

  it("the fake database answers the way the real client does: a thenable that is not a Promise and has no .catch (so code that needs .catch fails here, not only in CI)", () => {
    const b = realRpcBuilder({ data: null, error: null }) as unknown as Record<string, unknown>;
    expect(typeof b.then).toBe("function");
    expect(b.catch).toBeUndefined();
    expect(b.finally).toBeUndefined();
    expect(b instanceof Promise).toBe(false);
  });

  it("an answer that is not the expected row (none, not an array, a missing id on an 'ok') is lost, never free", async () => {
    for (const data of [null, [], {}, "x", [{ ok: true, claim_id: null, used: 1 }], [{ ok: "yes", claim_id: "c", used: 1 }], [{ ok: true, claim_id: "c", used: "1" }]]) {
      claimAnswer = { data, error: null };
      const a = await gate.checkFarahChatAllowance("user-1");
      expect(a.isFreeAllowance, JSON.stringify(data)).toBe(false);
    }
  });

  it("the function is MISSING (migration 0236 not applied yet): the old check-then-commit path is used, with one loud line, so a deploy that arrives before the migration does not turn every free message into a paid one", async () => {
    for (const code of ["PGRST202", "42883"]) {
      errorSpy.mockClear();
      claimAnswer = { data: null, error: { message: "Could not find the function", code } };
      const a = await gate.checkFarahChatAllowance("user-1");
      expect(a).toMatchObject({ isFreeAllowance: true, creditsSpent: 0, freeMessagesRemaining: 1 });
      expect(a.freeClaimId).toBeUndefined();
      expect(errorLines().filter((l) => l.startsWith("[farah-chat-gate] free claim function missing"))).toHaveLength(1);
      expect(errorLines().join("\n")).toContain("0236");
    }
  });
});

describe("commitFarahChatAllowance: a held claim becomes the free-allowance event, in the database, once", () => {
  const held = { isFreeAllowance: true, isPassCovered: false, creditsSpent: 0, creditsAvailableAtCheck: 5, freeMessagesRemaining: 1, freeClaimId: "claim-1" };

  it("calls the commit function with the claim, the account and the balance as of the check; writes no event of its own", async () => {
    const r = await gate.commitFarahChatAllowance("user-1", held);
    expect(rpcCalls).toEqual([["commit_farah_free_claim", { p_claim_id: "claim-1", p_user_id: "user-1", p_credits_available: 5 }]]);
    expect(logCreditGateEvent).not.toHaveBeenCalled();
    expect(r).toEqual({ balanceAfter: null });
  });

  it("a commit that says false (the claim had expired or was already settled) does not throw and does not charge; it logs one content-free line", async () => {
    commitAnswer = { data: false, error: null };
    await expect(gate.commitFarahChatAllowance("user-1", held)).resolves.toEqual({ balanceAfter: null });
    expect(errorLines().filter((l) => l.startsWith("[farah-chat-gate] a free claim could not be recorded"))).toEqual(["[farah-chat-gate] a free claim could not be recorded (expired or already settled)"]);
    expect(spendCredits).not.toHaveBeenCalled();
  });

  it("a commit that errors does not turn a delivered reply into an error either", async () => {
    commitAnswer = { data: null, error: { message: "boom", code: "57014" } };
    await expect(gate.commitFarahChatAllowance("user-1", held)).resolves.toEqual({ balanceAfter: null });
    expect(errorLines().join("\n")).toContain("code=57014");
  });

  it("a free message WITHOUT a claim id (the legacy path) is recorded the old way, as one event at commit", async () => {
    const { freeClaimId: _id, ...legacy } = held;
    void _id;
    await gate.commitFarahChatAllowance("user-1", legacy);
    expect(rpcCalls).toHaveLength(0);
    expect(logCreditGateEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", outcome: "covered_by_free_allowance", creditsRequired: 0, creditsAvailable: 5 }));
  });

  it("a credit message still spends its credit exactly as before", async () => {
    await gate.commitFarahChatAllowance("user-1", { isFreeAllowance: false, isPassCovered: false, creditsSpent: COST, creditsAvailableAtCheck: 5, freeMessagesRemaining: 0 });
    expect(spendCredits).toHaveBeenCalledTimes(1);
    expect(rpcCalls).toHaveLength(0);
  });
});

describe("releaseFarahChatAllowance: the slot is given back", () => {
  const held = { isFreeAllowance: true, isPassCovered: false, creditsSpent: 0, creditsAvailableAtCheck: 5, freeMessagesRemaining: 1, freeClaimId: "claim-1" };

  it("calls the release function with the claim and the account", async () => {
    await gate.releaseFarahChatAllowance("user-1", held);
    expect(rpcCalls).toEqual([["release_farah_free_claim", { p_claim_id: "claim-1", p_user_id: "user-1" }]]);
  });

  it("an allowance with no claim (paid, Pass, or legacy) calls nothing", async () => {
    await gate.releaseFarahChatAllowance("user-1", { ...held, freeClaimId: undefined });
    await gate.releaseFarahChatAllowance("user-1", { isFreeAllowance: false, isPassCovered: true, creditsSpent: 0, creditsAvailableAtCheck: 5, freeMessagesRemaining: null });
    expect(rpcCalls).toHaveLength(0);
  });

  it("a release that fails never throws (the claim then expires by itself) and logs one content-free line", async () => {
    releaseAnswer = { data: null, error: { message: "boom db-internal-7", code: "08006" } };
    await expect(gate.releaseFarahChatAllowance("user-secret-id", held)).resolves.toBeUndefined();
    expect(errorLines().filter((l) => l.startsWith("[farah-chat-gate] could not release a free claim"))).toEqual(["[farah-chat-gate] could not release a free claim (code=08006); it expires by itself"]);
    expect(errorLines().join("\n")).not.toMatch(/user-secret-id|db-internal-7/);
  });

  it("a release that throws instead of answering is swallowed too", async () => {
    const original = rpcCalls.push.bind(rpcCalls);
    vi.spyOn(rpcCalls, "push").mockImplementation((...a) => {
      original(...a);
      throw new Error("network down");
    });
    await expect(gate.releaseFarahChatAllowance("user-1", held)).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});
