/**
 * send-489 (issue #605) — commitTailoringAllowance RETURNS the balance, so /api/tailoring can tell the
 * masthead. Same rule as Farah chat (#609, tests/farah/chat-done-balance.test.ts): the number is the
 * LEDGER's own `balance_after` — what spend_credits_atomic computed under its lock and spendCredits
 * returns — never `creditsAvailableAtCheck - creditsSpent`, which is wrong whenever anything else touches
 * the balance between the check and the commit (a second tab, a top-up). `null` when nothing was spent
 * (free trial or Pass), so the client leaves the masthead alone. Charging logic is not under test and
 * not changed: every spend assertion is a pass-through of the existing spendCredits contract.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const spendCredits = vi.fn();
const logCreditGateEvent = vi.fn();
const profileUpdate = vi.fn();
vi.mock("@/lib/credits/spend", () => ({
  spendCredits: (...a: unknown[]) => spendCredits(...a),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));
vi.mock("@/lib/credits/gate-events", () => ({ logCreditGateEvent: (...a: unknown[]) => logCreditGateEvent(...a) }));
vi.mock("@/lib/passes/entitlement", () => ({ checkPassCoverage: vi.fn(), DAILY_CAP_MESSAGE: "cap" }));
vi.mock("@/lib/analytics/posthog", () => ({ captureEvent: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({ update: (...a: unknown[]) => ({ eq: () => (profileUpdate(...a), Promise.resolve({ error: null })) }) }),
  }),
}));

beforeEach(() => {
  spendCredits.mockReset();
  logCreditGateEvent.mockReset().mockResolvedValue(undefined);
  profileUpdate.mockReset();
});

const base = { isFreeTrial: false, isPassCovered: false, creditsSpent: 20, creditsAvailableAtCheck: 60 };

describe("commitTailoringAllowance returns the balance", () => {
  it("a paid run returns the ledger's balance_after, NOT the balance at check minus the cost", async () => {
    const { commitTailoringAllowance } = await import("@/lib/tailoring/gate");
    // Checked at 60 with a cost of 20 → a recomputed answer would be 40. Something else spent 5 in between,
    // so the ledger says 35. The masthead must be told 35.
    spendCredits.mockResolvedValue(35);
    const result = await commitTailoringAllowance("u1", "tailoring", base);
    expect(result).toEqual({ balanceAfter: 35 });
    expect(spendCredits).toHaveBeenCalledWith("u1", 20, "tailoring_run");
  });

  it("the cover-letter leg does the same, with its own reason", async () => {
    const { commitTailoringAllowance } = await import("@/lib/tailoring/gate");
    spendCredits.mockResolvedValue(12);
    const result = await commitTailoringAllowance("u1", "cover_letter", { ...base, creditsSpent: 8 });
    expect(result).toEqual({ balanceAfter: 12 });
    expect(spendCredits).toHaveBeenCalledWith("u1", 8, "cover_letter_run");
  });

  it("a free-trial run returns null: nothing was spent", async () => {
    const { commitTailoringAllowance } = await import("@/lib/tailoring/gate");
    const result = await commitTailoringAllowance("u1", "tailoring", { ...base, isFreeTrial: true, creditsSpent: 0 });
    expect(result).toEqual({ balanceAfter: null });
    expect(spendCredits).not.toHaveBeenCalled();
    expect(profileUpdate).toHaveBeenCalledWith({ free_trial_tailoring_used: true });
  });

  it("a Pass-covered run returns null: nothing was spent", async () => {
    const { commitTailoringAllowance } = await import("@/lib/tailoring/gate");
    const result = await commitTailoringAllowance("u1", "tailoring", { ...base, isPassCovered: true, creditsSpent: 0 });
    expect(result).toEqual({ balanceAfter: null });
    expect(spendCredits).not.toHaveBeenCalled();
  });
});
