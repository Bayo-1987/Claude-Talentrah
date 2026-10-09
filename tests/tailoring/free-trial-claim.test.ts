/**
 * TAILOR-RACE-1 (QA, P2): the one-time free tailoring trial was not one-time under parallel requests. checkTailoringAllowance READ `free_trial_tailoring_used` (false), the model ran, and only
 * commitTailoringAllowance set the flag, so every request that read the flag before the first commit was a free run: 5 simultaneous POSTs = 5 tailored resumes, each one burning LLM tokens (the shared Groq
 * daily budget Farah also needs) for nothing. The same shape applied to the free cover-letter trial.
 *
 * Now the check CLAIMS the trial in one conditional UPDATE (`... where flag = false returning`) before the model runs; a request that loses the claim is a paid request (credits, or a 402 with none). The
 * claim is given back when the generation fails (the route calls `allowance.release()`), so a failed run still does not burn the trial. The paid path, the Pass path and the commit are unchanged.
 *
 * The fake table below applies a conditional update atomically and makes every read yield first, so parallel callers genuinely interleave: with the old read-only check the five-at-once case returns five
 * free trials. Fakes only; no database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Profile = { id: string; free_trial_tailoring_used: boolean; free_trial_cover_letter_used: boolean; credits_balance: number };
const world = vi.hoisted(() => ({ profile: null as unknown as Record<string, unknown>, spends: [] as Array<[string, number, string]>, updates: [] as Array<Record<string, unknown>> }));

function builder(table: string) {
  const filters: Array<[string, unknown]> = [];
  let patch: Record<string, unknown> | null = null;
  let returning = false;
  const matches = () => filters.every(([col, val]) => world.profile[col] === val);
  const run = async () => {
    await Promise.resolve();
    await Promise.resolve();
    if (patch) {
      if (!matches()) return { data: [], error: null };
      Object.assign(world.profile, patch);
      world.updates.push(patch);
      return { data: returning ? [{ id: world.profile.id }] : null, error: null };
    }
    return { data: matches() ? { ...world.profile } : null, error: null };
  };
  const chain: Record<string, unknown> = {
    select: () => {
      returning = true;
      return chain;
    },
    update: (p: Record<string, unknown>) => {
      patch = p;
      return chain;
    },
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return chain;
    },
    single: () => run(),
    maybeSingle: () => run(),
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => run().then(resolve, reject),
  };
  void table;
  return chain;
}

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock("@/lib/credits/spend", () => ({
  spendCredits: async (userId: string, amount: number, reason: string) => {
    world.spends.push([userId, amount, reason]);
    return 0;
  },
  InsufficientCreditsError: class InsufficientCreditsError extends Error {
    capMessage?: string;
    constructor(
      public required = 0,
      public available = 0,
      capMessage?: string,
    ) {
      super("insufficient");
      this.capMessage = capMessage;
    }
  },
}));
vi.mock("@/lib/credits/gate-events", () => ({ logCreditGateEvent: async () => undefined }));
vi.mock("@/lib/passes/entitlement", () => ({ checkPassCoverage: async () => ({ covered: false, reason: "no_pass" }), DAILY_CAP_MESSAGE: "cap" }));
vi.mock("@/lib/analytics/posthog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/analytics/posthog")>()), captureEvent: vi.fn() }));

const { checkTailoringAllowance, commitTailoringAllowance, InsufficientCreditsError } = await import("@/lib/tailoring/gate");

const fresh = (over: Partial<Profile> = {}) => {
  world.profile = { id: "u1", free_trial_tailoring_used: false, free_trial_cover_letter_used: false, credits_balance: 0, ...over };
  world.spends = [];
  world.updates = [];
};
const settle = (n: number, kind: "tailoring" | "cover_letter") =>
  Promise.allSettled(Array.from({ length: n }, () => checkTailoringAllowance("u1", kind)));

beforeEach(() => fresh());

describe("five simultaneous requests with the trial unused and no credits", () => {
  it("tailoring: exactly one gets the free trial, the other four are refused for credits", async () => {
    const results = await settle(5, "tailoring");
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect((ok[0] as PromiseFulfilledResult<{ isFreeTrial: boolean }>).value.isFreeTrial).toBe(true);
    expect(refused).toHaveLength(4);
    for (const r of refused) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientCreditsError);
    expect(world.profile.free_trial_tailoring_used).toBe(true);
  });
  it("cover letter: the same, on its own flag", async () => {
    const results = await settle(5, "cover_letter");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(4);
    expect(world.profile.free_trial_cover_letter_used).toBe(true);
  });
  it("the two trials are independent: one tailoring and one cover letter at once both get theirs", async () => {
    const [a, b] = await Promise.all([checkTailoringAllowance("u1", "tailoring"), checkTailoringAllowance("u1", "cover_letter")]);
    expect([a.isFreeTrial, b.isFreeTrial]).toEqual([true, true]);
  });
});

describe("with credits", () => {
  it("five at once: one free run and four PAID runs (the paid path is untouched: priced at check, spent at commit)", async () => {
    fresh({ credits_balance: 500 });
    const results = await settle(5, "tailoring");
    const allowances = results.map((r) => (r as PromiseFulfilledResult<{ isFreeTrial: boolean; creditsSpent: number }>).value);
    expect(allowances.filter((a) => a.isFreeTrial)).toHaveLength(1);
    expect(allowances.filter((a) => !a.isFreeTrial && a.creditsSpent > 0)).toHaveLength(4);
    expect(world.spends, "nothing is spent at the check").toEqual([]);
  });
});

describe("giving the trial back", () => {
  it("a claimed allowance can be released, and the next request claims the trial again", async () => {
    const first = await checkTailoringAllowance("u1", "tailoring");
    expect(first.isFreeTrial).toBe(true);
    expect(world.profile.free_trial_tailoring_used).toBe(true);
    await first.release?.();
    expect(world.profile.free_trial_tailoring_used).toBe(false);
    const second = await checkTailoringAllowance("u1", "tailoring");
    expect(second.isFreeTrial).toBe(true);
  });
  it("only the request that claimed it can give it back: a paid allowance has nothing to release", async () => {
    fresh({ free_trial_tailoring_used: true, credits_balance: 500 });
    const paid = await checkTailoringAllowance("u1", "tailoring");
    expect(paid.isFreeTrial).toBe(false);
    expect(paid.release).toBeUndefined();
    expect(world.profile.free_trial_tailoring_used).toBe(true);
  });
  it("releasing the cover letter's trial leaves the tailoring trial alone", async () => {
    const [t, c] = await Promise.all([checkTailoringAllowance("u1", "tailoring"), checkTailoringAllowance("u1", "cover_letter")]);
    await c.release?.();
    expect(world.profile.free_trial_cover_letter_used).toBe(false);
    expect(world.profile.free_trial_tailoring_used).toBe(true);
    void t;
  });
});

describe("the commit after a claim", () => {
  it("leaves the trial used, spends nothing, and reports no balance change", async () => {
    const claimed = await checkTailoringAllowance("u1", "tailoring");
    const done = await commitTailoringAllowance("u1", "tailoring", claimed);
    expect(done).toEqual({ balanceAfter: null });
    expect(world.profile.free_trial_tailoring_used).toBe(true);
    expect(world.spends).toEqual([]);
  });
});
