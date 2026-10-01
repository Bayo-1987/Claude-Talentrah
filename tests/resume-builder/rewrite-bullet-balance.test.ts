/**
 * send-489 (issue #605) — rewriteBulletAction returns the account's NEW credit balance, so the resume editor
 * can tell the masthead. It was a bare server-action call with no refresh at all, so the pill kept showing the
 * pre-charge number. Same rule as Farah chat (#609): the number is spendCredits' return, the ledger's own
 * `balance_after`, never `balance - cost` recomputed from the check-time read. `undefined` (absent) when nothing
 * was spent — a Pass-covered rewrite, or any error return — so the editor leaves the masthead alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainable } from "../credits/chainable";

const spendCredits = vi.fn();
const checkPassCoverage = vi.fn();
const rewriteBullet = vi.fn();
let balance = 60;

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => chainable({ data: { credits_balance: balance }, error: null }),
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/credits/spend", () => ({
  spendCredits: (...a: unknown[]) => spendCredits(...a),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));
vi.mock("@/lib/credits/gate-events", () => ({ logCreditGateEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/passes/entitlement", () => ({
  checkPassCoverage: (...a: unknown[]) => checkPassCoverage(...a),
  DAILY_CAP_MESSAGE: "cap",
}));
vi.mock("@/lib/farah/rewrite-bullet", () => ({ rewriteBullet: (...a: unknown[]) => rewriteBullet(...a) }));
vi.mock("@/lib/resume/upsert-base-resume", () => ({ upsertBaseResume: vi.fn() }));
vi.mock("@/lib/resume-builder/start-events", () => ({
  logResumeBuilderStartEvent: vi.fn(),
  logResumeBuilderCompletion: vi.fn(),
}));

const { rewriteBulletAction } = await import("@/lib/resume-builder/actions");
const { CREDIT_COSTS } = await import("@/lib/credits/costs");

beforeEach(() => {
  balance = 60;
  spendCredits.mockReset();
  checkPassCoverage.mockReset().mockResolvedValue({ covered: false });
  rewriteBullet.mockReset().mockResolvedValue("A tighter bullet.");
});

describe("rewriteBulletAction — creditsBalance", () => {
  it("a paid rewrite returns the ledger's balance_after, NOT the balance read at check minus the cost", async () => {
    // Read at 60, cost CREDIT_COSTS.bulletRewrite → a recomputed answer would be 60 - cost. Something else
    // spent in between, so the ledger says 41. The editor must be told 41.
    spendCredits.mockResolvedValue(41);
    const res = (await rewriteBulletAction("Led a team.", "impact")) as { text: string; creditsBalance?: number };
    expect(res.text).toBe("A tighter bullet.");
    expect(res.creditsBalance).toBe(41);
    expect(res.creditsBalance).not.toBe(60 - CREDIT_COSTS.bulletRewrite);
    expect(spendCredits).toHaveBeenCalledWith("u1", CREDIT_COSTS.bulletRewrite, "bullet_rewrite");
  });

  it("a Pass-covered rewrite carries no balance: nothing was spent", async () => {
    checkPassCoverage.mockResolvedValue({ covered: true });
    const res = (await rewriteBulletAction("Led a team.", "impact")) as { text: string; creditsBalance?: number };
    expect(res.text).toBe("A tighter bullet.");
    expect(res.creditsBalance).toBeUndefined();
    expect(spendCredits).not.toHaveBeenCalled();
  });

  it("a failed rewrite carries no balance and spends nothing", async () => {
    rewriteBullet.mockRejectedValue(new Error("provider down"));
    const res = (await rewriteBulletAction("Led a team.", "impact")) as { text: string; error?: string; creditsBalance?: number };
    expect(res.error).toMatch(/couldn't rewrite/i);
    expect(res.creditsBalance).toBeUndefined();
    expect(spendCredits).not.toHaveBeenCalled();
  });

  it("an unaffordable rewrite carries no balance and spends nothing", async () => {
    balance = 0;
    const res = (await rewriteBulletAction("Led a team.", "impact")) as { error?: string; creditsBalance?: number };
    expect(res.error).toMatch(/Not enough credits/);
    expect(res.creditsBalance).toBeUndefined();
    expect(spendCredits).not.toHaveBeenCalled();
  });

  it("empty text is returned untouched with no balance", async () => {
    const res = (await rewriteBulletAction("   ", "impact")) as { text: string; creditsBalance?: number };
    expect(res.text).toBe("   ");
    expect(res.creditsBalance).toBeUndefined();
  });
});
