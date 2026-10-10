/**
 * send-485 (issue #605) — the chat stream's `done` event carries the account's NEW credit balance, so the
 * masthead can update without a reload.
 *
 * Two layers, both pure (mocked at the module boundary, runnable without a database):
 *
 *  1. commitFarahChatAllowance RETURNS the balance, and it is the ledger's own `balance_after` — the value
 *     spend_credits_atomic (0035) computed under its lock — not `creditsAvailableAtCheck - cost`. The two
 *     differ whenever anything else touches the balance between the check and the commit (a second tab, a
 *     tailoring run, a top-up landing), and the recomputed number would then be a lie on the masthead.
 *  2. The route puts it on the `done` event: a number for a paid message, `null` for a free or Pass-covered
 *     one (nothing was spent, so there is nothing to update), and on the persistence-failed `done` too —
 *     that message cost a credit even though saving the transcript failed.
 *
 * Charging logic is not under test here and not changed: every assertion about spending is a
 * pass-through of the existing spendCredits contract.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const spendCredits = vi.fn();
const logCreditGateEvent = vi.fn();
vi.mock("@/lib/credits/spend", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/credits/spend")>()),
  spendCredits: (...a: unknown[]) => spendCredits(...a),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));
vi.mock("@/lib/credits/gate-events", () => ({ logCreditGateEvent: (...a: unknown[]) => logCreditGateEvent(...a) }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/passes/entitlement", () => ({ checkPassCoverage: vi.fn(), DAILY_CAP_MESSAGE: "cap" }));

beforeEach(() => {
  spendCredits.mockReset();
  logCreditGateEvent.mockReset().mockResolvedValue(undefined);
});

describe("commitFarahChatAllowance returns the balance", () => {
  it("a paid message returns the ledger's balance_after, NOT the balance at check minus the cost", async () => {
    const { commitFarahChatAllowance } = await import("@/lib/farah/chat-gate");
    // Checked at 41 with a cost of 1 → a recomputed answer would be 40. Something else spent 5 credits
    // in between, so the ledger says 35. The masthead must be told 35.
    spendCredits.mockResolvedValue(35);
    const result = await commitFarahChatAllowance("u1", {
      isFreeAllowance: false,
      isPassCovered: false,
      creditsSpent: 1,
      creditsAvailableAtCheck: 41,
      freeMessagesRemaining: 0,
    });
    expect(result).toEqual({ balanceAfter: 35 });
    expect(spendCredits).toHaveBeenCalledWith("u1", 1, "farah_chat_message");
  });

  it("a free-allowance message returns null: nothing was spent", async () => {
    const { commitFarahChatAllowance } = await import("@/lib/farah/chat-gate");
    const result = await commitFarahChatAllowance("u1", {
      isFreeAllowance: true,
      isPassCovered: false,
      creditsSpent: 0,
      creditsAvailableAtCheck: 41,
      freeMessagesRemaining: 2,
    });
    expect(result).toEqual({ balanceAfter: null });
    expect(spendCredits).not.toHaveBeenCalled();
  });

  it("a Pass-covered message returns null: nothing was spent", async () => {
    const { commitFarahChatAllowance } = await import("@/lib/farah/chat-gate");
    const result = await commitFarahChatAllowance("u1", {
      isFreeAllowance: false,
      isPassCovered: true,
      creditsSpent: 0,
      creditsAvailableAtCheck: 41,
      freeMessagesRemaining: null,
    });
    expect(result).toEqual({ balanceAfter: null });
    expect(spendCredits).not.toHaveBeenCalled();
  });
});
