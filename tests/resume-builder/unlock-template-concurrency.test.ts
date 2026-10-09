/**
 * UNLOCK-RACE-1 (P1, money). Unlocking a premium template from two tabs at once charged the credits twice (read the unlock, spend, THEN insert: both requests pass the read and both spend; the
 * second insert hits the unique (user_id, template_id) and fails with "Couldn't save the unlock"). The unlock row is now CLAIMED FIRST: only the request whose insert wins spends, a conflict
 * means "already unlocked" and charges nothing, and a refused or failed spend gives the row back so the user can retry.
 *
 * Real concurrency: two calls started together against an in-memory table that enforces the unique constraint atomically, with every await yielding to the event loop so the old
 * read-spend-insert order interleaves exactly as it does against two requests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  FakeInsufficient: class FakeInsufficient extends Error {
    constructor(public required: number, public available: number) {
      super("insufficient");
    }
  },
  unlocks: [] as Array<{ id: string; user_id: string; template_id: string }>,
  spends: [] as number[],
  balance: { value: 100 },
  spendBehaviour: "ok" as "ok" | "insufficient" | "throws",
  logged: [] as unknown[],
  nextId: { n: 1 },
}));
const tick = () => new Promise((r) => setTimeout(r, 0));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/credits/spend", () => ({
  InsufficientCreditsError: h.FakeInsufficient,
  spendCredits: async (_u: string, amount: number) => {
    await tick();
    if (h.spendBehaviour === "insufficient") throw new h.FakeInsufficient(amount, 3);
    if (h.spendBehaviour === "throws") throw new Error("ledger down");
    h.spends.push(amount);
    h.balance.value -= amount;
    return { balanceAfter: h.balance.value };
  },
}));
vi.mock("@/lib/credits/gate-events", () => ({ logCreditGateEvent: async (e: unknown) => { h.logged.push(e); } }));
vi.mock("@/lib/passes/entitlement", () => ({ checkPassCoverage: async () => ({ covered: false }), DAILY_CAP_MESSAGE: "cap" }));

function unlocksTable() {
  const filters: Array<[string, unknown]> = [];
  let mode: "select" | "insert" | "delete" = "select";
  let row: Record<string, string> | null = null;
  const b: Record<string, unknown> = {
    select: () => b,
    insert: (r: Record<string, string>) => { mode = "insert"; row = r; return b; },
    delete: () => { mode = "delete"; return b; },
    eq: (c: string, v: unknown) => { filters.push([c, v]); return b; },
    maybeSingle: async () => { await tick(); return { data: h.unlocks.find((u) => filters.every(([c, v]) => (u as Record<string, unknown>)[c] === v)) ? { id: "x" } : null, error: null }; },
    single: async () => {
      await tick();
      if (mode === "insert") {
        // ATOMIC unique (user_id, template_id): the check and the write happen in one synchronous step.
        if (h.unlocks.some((u) => u.user_id === row!.user_id && u.template_id === row!.template_id)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        const created = { id: `u${h.nextId.n++}`, user_id: row!.user_id, template_id: row!.template_id };
        h.unlocks.push(created);
        return { data: { id: created.id }, error: null };
      }
      return { data: null, error: null };
    },
    then: (resolve: (v: unknown) => unknown) => {
      return tick().then(() => {
        if (mode === "delete") {
          const before = h.unlocks.length;
          for (let i = h.unlocks.length - 1; i >= 0; i--) if (filters.every(([c, v]) => (h.unlocks[i] as Record<string, unknown>)[c] === v)) h.unlocks.splice(i, 1);
          return resolve({ data: null, error: null, count: before - h.unlocks.length });
        }
        if (mode === "insert") {
          if (h.unlocks.some((u) => u.user_id === row!.user_id && u.template_id === row!.template_id)) return resolve({ data: null, error: { code: "23505", message: "duplicate key" } });
          h.unlocks.push({ id: `u${h.nextId.n++}`, user_id: row!.user_id, template_id: row!.template_id });
          return resolve({ data: null, error: null });
        }
        return resolve({ data: null, error: null });
      });
    },
  };
  return b;
}
function templatesTable() {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    single: async () => { await tick(); return { data: { id: "t1", is_premium: true, unlock_cost_credits: 10 }, error: null }; },
  };
  return b;
}
const client = { from: (t: string) => (t === "user_template_unlocks" ? unlocksTable() : templatesTable()) };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ ...client, auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }) }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => client }));

import { unlockTemplateAction } from "@/lib/resume-builder/actions";

beforeEach(() => {
  h.unlocks.length = 0;
  h.spends.length = 0;
  h.balance.value = 100;
  h.spendBehaviour = "ok";
  h.logged.length = 0;
  h.nextId.n = 1;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("unlockTemplateAction", () => {
  it("two simultaneous unlocks of the same template charge the credits ONCE and leave ONE unlock row", async () => {
    const [a, b] = await Promise.all([unlockTemplateAction("t1"), unlockTemplateAction("t1")]);
    expect(a.ok && b.ok, "both tabs are told the template is unlocked").toBe(true);
    expect(h.spends, "charged exactly once").toEqual([10]);
    expect(h.balance.value).toBe(90);
    expect(h.unlocks).toHaveLength(1);
  });

  it("five simultaneous unlocks still charge once", async () => {
    await Promise.all(Array.from({ length: 5 }, () => unlockTemplateAction("t1")));
    expect(h.spends).toEqual([10]);
    expect(h.unlocks).toHaveLength(1);
  });

  it("a single unlock charges once and records the unlock (unchanged)", async () => {
    expect(await unlockTemplateAction("t1")).toEqual({ ok: true });
    expect(h.spends).toEqual([10]);
    expect(h.unlocks).toHaveLength(1);
  });

  it("an already-unlocked template charges nothing", async () => {
    await unlockTemplateAction("t1");
    h.spends.length = 0;
    expect(await unlockTemplateAction("t1")).toEqual({ ok: true });
    expect(h.spends).toEqual([]);
  });

  it("too few credits: the refusal message is unchanged, nothing is charged, and the claimed row is given back so the user can retry", async () => {
    h.spendBehaviour = "insufficient";
    const r = await unlockTemplateAction("t1");
    expect(r).toEqual({ ok: false, error: "Not enough credits — this template needs 10, you have 3." });
    expect(h.spends).toEqual([]);
    expect(h.unlocks, "no unlock without a payment").toHaveLength(0);
    expect(h.logged).toContainEqual(expect.objectContaining({ outcome: "blocked_insufficient_credits" }));
    h.spendBehaviour = "ok";
    expect(await unlockTemplateAction("t1")).toEqual({ ok: true });
    expect(h.spends).toEqual([10]);
  });

  it("a spend that throws gives the row back too, then rethrows (no free unlock)", async () => {
    h.spendBehaviour = "throws";
    await expect(unlockTemplateAction("t1")).rejects.toThrow("ledger down");
    expect(h.unlocks).toHaveLength(0);
    expect(h.spends).toEqual([]);
  });
});
