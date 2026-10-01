/**
 * send-489 (issue #605) — the two credit-paid scholarship actions return the account's NEW credit balance.
 *
 * WHY THESE TWO WERE NOT LEFT TO revalidatePath. Both call `revalidatePath("/scholarships")` after the spend,
 * and Next's own documentation for it (node_modules/next/dist/docs/.../revalidatePath.md) says a Server
 * Function "updates the UI immediately (if viewing the affected path)". The buttons live in FarahActions,
 * rendered on /scholarships (the list, via ScholarshipCard: the affected path) AND on /scholarships/[id]
 * (the detail page: NOT the path that was revalidated). So on the detail page the masthead pill and
 * FarahActions' own "You have N credits" stayed at the pre-charge number. The fix is the same one #609 gave
 * Farah chat, and it does not depend on which page the visitor is on: the action returns the ledger's own
 * `balance_after` and the client reports it. (e2e/credit-balance-live.spec.ts checks both pages end to end.)
 *
 * Same rule as everywhere: the number is spendCredits' return, never `balance - cost`; absent when nothing was
 * spent (Pass-covered, or any error return).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainable } from "../credits/chainable";

const spendCredits = vi.fn();
const checkPassCoverage = vi.fn();
const checkEligibility = vi.fn();
const draftPersonalStatement = vi.fn();
let balance = 60;

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => {
      if (table === "scholarships") return chainable({ data: { id: "s1", program_name: "P" }, error: null });
      if (table === "profiles") return chainable({ data: { credits_balance: balance, country: "Nigeria" }, error: null });
      return chainable({ data: null, error: null });
    },
  }),
}));
vi.mock("@/lib/credits/spend", () => ({
  spendCredits: (...a: unknown[]) => spendCredits(...a),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));
vi.mock("@/lib/credits/gate-events", () => ({ logCreditGateEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/passes/entitlement", () => ({
  checkPassCoverage: (...a: unknown[]) => checkPassCoverage(...a),
  DAILY_CAP_MESSAGE: "cap",
}));
vi.mock("@/lib/scholarships/farah", () => ({
  checkEligibility: (...a: unknown[]) => checkEligibility(...a),
  draftPersonalStatement: (...a: unknown[]) => draftPersonalStatement(...a),
}));

const { runEligibilityCheckAction, draftSopAction } = await import("@/lib/scholarships/actions");
const { CREDIT_COSTS } = await import("@/lib/credits/costs");

type WithBalance = { creditsBalance?: number; error?: string };

beforeEach(() => {
  balance = 60;
  spendCredits.mockReset();
  checkPassCoverage.mockReset().mockResolvedValue({ covered: false });
  checkEligibility.mockReset().mockResolvedValue({ verdict: "likely_eligible", summary: "ok", criteria: [], suggestedNextSteps: [] });
  draftPersonalStatement.mockReset().mockResolvedValue("A draft statement.");
});

describe("runEligibilityCheckAction — creditsBalance", () => {
  it("returns the ledger's balance_after, not the balance read at check minus the cost", async () => {
    spendCredits.mockResolvedValue(33);
    const res = (await runEligibilityCheckAction("s1")) as WithBalance & { result?: unknown };
    expect(res.result).toBeTruthy();
    expect(res.creditsBalance).toBe(33);
    expect(res.creditsBalance).not.toBe(60 - CREDIT_COSTS.scholarshipEligibilityCheck);
    expect(spendCredits).toHaveBeenCalledWith("u1", CREDIT_COSTS.scholarshipEligibilityCheck, "scholarship_eligibility_check", "s1");
  });

  it("a Pass-covered check carries no balance", async () => {
    checkPassCoverage.mockResolvedValue({ covered: true });
    const res = (await runEligibilityCheckAction("s1")) as WithBalance & { result?: unknown };
    expect(res.result).toBeTruthy();
    expect(res.creditsBalance).toBeUndefined();
    expect(spendCredits).not.toHaveBeenCalled();
  });

  it("an unaffordable check carries no balance and spends nothing", async () => {
    balance = 0;
    const res = (await runEligibilityCheckAction("s1")) as WithBalance;
    expect(res.error).toMatch(/Not enough credits/);
    expect(res.creditsBalance).toBeUndefined();
    expect(spendCredits).not.toHaveBeenCalled();
  });

  it("a failed check carries no balance and spends nothing", async () => {
    checkEligibility.mockRejectedValue(new Error("provider down"));
    const res = (await runEligibilityCheckAction("s1")) as WithBalance;
    expect(res.error).toMatch(/couldn't run that check/i);
    expect(res.creditsBalance).toBeUndefined();
    expect(spendCredits).not.toHaveBeenCalled();
  });
});

describe("draftSopAction — creditsBalance", () => {
  it("returns the ledger's balance_after, not the balance read at check minus the cost", async () => {
    spendCredits.mockResolvedValue(27);
    const res = (await draftSopAction("s1", "I want to study.")) as WithBalance & { statement?: string };
    expect(res.statement).toBe("A draft statement.");
    expect(res.creditsBalance).toBe(27);
    expect(res.creditsBalance).not.toBe(60 - CREDIT_COSTS.scholarshipSopDraft);
    expect(spendCredits).toHaveBeenCalledWith("u1", CREDIT_COSTS.scholarshipSopDraft, "scholarship_sop_draft", "s1");
  });

  it("a Pass-covered draft carries no balance", async () => {
    checkPassCoverage.mockResolvedValue({ covered: true });
    const res = (await draftSopAction("s1", "")) as WithBalance & { statement?: string };
    expect(res.statement).toBe("A draft statement.");
    expect(res.creditsBalance).toBeUndefined();
    expect(spendCredits).not.toHaveBeenCalled();
  });

  it("an empty draft carries no balance and spends nothing", async () => {
    draftPersonalStatement.mockResolvedValue("");
    const res = (await draftSopAction("s1", "")) as WithBalance;
    expect(res.error).toMatch(/came back empty/i);
    expect(res.creditsBalance).toBeUndefined();
    expect(spendCredits).not.toHaveBeenCalled();
  });
});
