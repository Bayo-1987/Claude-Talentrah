/**
 * The free-message claim END TO END (migration 0236): the REAL gate and the REAL chat and history routes against a small in-memory database, with the three claim functions modelled rule by rule
 * (tests/farah/support/free-claim-model.ts). Only the model, the credit spend and the ceiling tally are faked. This is what shows the claim doing its job through the routes: parallel requests can no
 * longer push an account past its free messages, a message that fails gives its slot back, and a slot nobody gives back (the release itself failing, or a crash) comes back by expiry.
 *
 * Time is fixed with fake Date only, so "120 seconds" is exact. The model is one synchronous step per call, as the database's lock plus single statements make each real call; the real database
 * behaviour is tested in tests/farah/free-claim.test.ts (CI only).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { freeClaimRpc } from "./support/free-claim-model";
import { realRpcBuilder } from "./support/real-rpc-builder";

type Row = Record<string, unknown>;
const NOW = new Date("2026-10-31T12:00:00.000Z");
const DAY = 86_400_000;
const at = (offsetDays: number) => new Date(NOW.getTime() + offsetDays * DAY).toISOString();
const USER = "11111111-1111-1111-1111-111111111111";

const store: Record<string, Row[]> = {};
let persistFails = false;
let nextId = 1;
const rows = (t: string) => (store[t] ??= []);

function query(name: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let head = false;
  let order: { col: string; asc: boolean } | null = null;
  let lim: number | null = null;
  const run = () => {
    let out = rows(name).filter((r) => filters.every((f) => f(r)));
    if (order) out = [...out].sort((a, b) => (String(a[order!.col]) < String(b[order!.col]) ? -1 : 1) * (order!.asc ? 1 : -1));
    if (lim !== null) out = out.slice(0, lim);
    return out;
  };
  const api: Record<string, unknown> = {
    select: (_cols?: string, opts?: { head?: boolean }) => ((head = !!opts?.head), api),
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), api),
    gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), api),
    gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), api),
    lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), api),
    is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), api),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), api),
    order: (c: string, o?: { ascending?: boolean }) => ((order = { col: c, asc: o?.ascending !== false }), api),
    limit: (n: number) => ((lim = n), api),
    single: async () => ({ data: run()[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    insert: (row: Row | Row[]) => {
      const failed = name === "farah_messages" && persistFails;
      const made = failed ? [] : (Array.isArray(row) ? row : [row]).map((r) => ({ id: `id-${nextId++}`, created_at: new Date().toISOString(), ...r }));
      if (!failed) rows(name).push(...made);
      const result = failed ? { data: null, error: { message: "insert failed", code: "XX000" } } : { data: made[0], error: null };
      const b: Record<string, unknown> = { select: () => b, single: async () => result, then: (resolve: (v: unknown) => void) => resolve(result) };
      return b;
    },
    then: (resolve: (v: unknown) => void) => {
      const out = run();
      resolve(head ? { count: out.length, data: null, error: null } : { data: out, count: out.length, error: null });
    },
  };
  return api;
}
let releaseFails = false;
const fakeDb = () => ({
  from: (t: string) => query(t),
  // The claim functions of migration 0236, modelled rule by rule (tests/farah/support/free-claim-model.ts). `releaseFails` makes the release answer with an error, as a lost connection would.
  rpc: (fn: string, args: Record<string, unknown>) =>
    realRpcBuilder(releaseFails && fn === "release_farah_free_claim" ? { data: null, error: { message: "connection lost", code: "08006" } } : freeClaimRpc(store, fn, args, Date.now())),
  auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
});

const spendCredits = vi.fn(async () => 4);
const askFarahChatStream = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeDb() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => fakeDb() }));
vi.mock("@/lib/credits/spend", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/credits/spend")>()), spendCredits, InsufficientCreditsError: class InsufficientCreditsError extends Error { constructor(public required: number, public available: number, public capMessage?: string) { super("insufficient"); } } }));
vi.mock("@/lib/farah/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/farah/client")>()), askFarahChatStream }));
vi.mock("@/lib/farah/session-events", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/farah/session-events")>()), logFarahSessionMessage: vi.fn(async () => undefined) }));
vi.mock("@/lib/farah/spend-tally", async () => (await import("./support/route-mocks")).safeSpendTally());

const { POST } = await import("@/app/api/farah/chat/route");
const { CREDIT_COSTS } = await import("@/lib/credits/costs");

function freeEvent(offsetDays: number): Row {
  return { user_id: USER, reason: "farah_chat_message", outcome: "covered_by_free_allowance", created_at: at(offsetDays) };
}
const freeEvents = () => rows("credit_gate_events").filter((r) => r.outcome === "covered_by_free_allowance");
function seed(opts: { freeUsedAt?: number[]; balance?: number; pass?: { expiresInDays: number; status?: string } }) {
  for (const k of Object.keys(store)) delete store[k];
  rows("profiles").push({ id: USER, credits_balance: opts.balance ?? 0 });
  for (const d of opts.freeUsedAt ?? []) rows("credit_gate_events").push(freeEvent(d));
  if (opts.pass) rows("user_passes").push({ id: "p1", user_id: USER, status: opts.pass.status ?? "active", expires_at: at(opts.pass.expiresInDays) });
}
async function send(): Promise<Array<Record<string, unknown>>> {
  const res = await POST(new Request("http://localhost/api/farah/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Hello" }) }));
  return (await res.text()).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}
const doneOf = (events: Array<Record<string, unknown>>) => events.find((e) => e.type === "done");


const eventsAt = (events: Array<Record<string, unknown>>) => events;
const SECOND = 1000;
const claimCount = () => rows("farah_free_claims").length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  persistFails = false;
  releaseFails = false;
  nextId = 1;
  spendCredits.mockClear();
  askFarahChatStream.mockReset().mockImplementation(async function* () {
    yield "A reply.";
  });
});
afterEach(() => vi.useRealTimers());

describe("parallel requests can no longer push an account past its free messages", () => {
  it("10 at once with 2 of 3 used and no credits: exactly one reply is free; the other 9 are refused as 'not enough credits'; the account ends at 3 free messages and nothing is left pending", async () => {
    seed({ freeUsedAt: [-20, -5], balance: 0 });
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => send()));
    expect(outcomes.filter((e) => doneOf(eventsAt(e)))).toHaveLength(1);
    expect(outcomes.filter((e) => !doneOf(eventsAt(e)) && JSON.stringify(e).includes("needsCredits"))).toHaveLength(9);
    expect(freeEvents()).toHaveLength(3);
    expect(claimCount()).toBe(0);
    expect(askFarahChatStream, "the model was called once, not ten times: the losers were refused BEFORE the call").toHaveBeenCalledTimes(1);
    expect(spendCredits).not.toHaveBeenCalled();
  });

  it("10 at once with 2 of 3 used and credits: one is free and the other 9 are paid messages, each charged exactly once; the free count still ends at 3", async () => {
    seed({ freeUsedAt: [-20, -5], balance: 50 });
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => send()));
    expect(outcomes.filter((e) => doneOf(eventsAt(e)))).toHaveLength(10);
    expect(spendCredits).toHaveBeenCalledTimes(9);
    expect(spendCredits).toHaveBeenCalledWith(USER, CREDIT_COSTS.farahChatMessage, "farah_chat_message");
    expect(freeEvents()).toHaveLength(3);
    expect(claimCount()).toBe(0);
  });

  it("10 at once from a fresh account: exactly the 3 free messages are granted", async () => {
    seed({ freeUsedAt: [], balance: 0 });
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => send()));
    expect(outcomes.filter((e) => doneOf(eventsAt(e)))).toHaveLength(3);
    expect(freeEvents()).toHaveLength(3);
  });

  it("an account with a Pass and all 3 free messages in flight at once: the Pass covers the rest (no credits spent)", async () => {
    seed({ freeUsedAt: [], balance: 0, pass: { expiresInDays: 5 } });
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => send()));
    expect(outcomes.filter((e) => doneOf(eventsAt(e)))).toHaveLength(6);
    expect(freeEvents()).toHaveLength(3);
    expect(spendCredits).not.toHaveBeenCalled();
  });
});

describe("a message that fails gives its slot back", () => {
  it("a model failure releases the claim: nothing is recorded, the next request gets the free message", async () => {
    seed({ freeUsedAt: [-20, -5], balance: 0 });
    askFarahChatStream.mockImplementationOnce(async function* () {
      throw new Error("provider down");
      yield "x";
    });
    const failed = await send();
    expect(doneOf(failed)).toBeUndefined();
    expect(claimCount()).toBe(0);
    expect(freeEvents()).toHaveLength(2);
    const ok = doneOf(await send())!;
    expect(ok.freeMessagesRemaining).toBe(0);
    expect(freeEvents()).toHaveLength(3);
  });

  it("a reply cut off at the length cap uses no free slot", async () => {
    seed({ freeUsedAt: [-20, -5], balance: 0 });
    askFarahChatStream.mockImplementationOnce(async function* (_t: unknown, _c: unknown, _m: unknown, opts?: { onFinish?: (r: string) => void }) {
      yield "cut o";
      opts?.onFinish?.("length");
    });
    const cut = doneOf(await send())!;
    expect(cut.truncated).toBe(true);
    expect(cut.freeMessagesRemaining).toBe(1);
    expect(freeEvents()).toHaveLength(2);
    expect(claimCount()).toBe(0);
  });
});

describe("a slot nobody gives back comes back by itself after 120 seconds", () => {
  it("a crashed request (a claim taken and never settled): the slot is held for 119 seconds and is free again at 121 (time-controlled)", async () => {
    seed({ freeUsedAt: [-20, -5], balance: 0 });
    freeClaimRpc(store, "claim_farah_free_message", { p_user_id: USER, p_allowance: 3, p_window_days: 30, p_hold_seconds: 120 }, Date.now());
    expect(claimCount()).toBe(1);
    vi.setSystemTime(new Date(NOW.getTime() + 119 * SECOND));
    const held = await send();
    expect(doneOf(held)).toBeUndefined();
    vi.setSystemTime(new Date(NOW.getTime() + 121 * SECOND));
    expect(doneOf(await send())).toBeDefined();
    expect(freeEvents()).toHaveLength(3);
  });

  it("the release ITSELF failing (a lost connection): the failed message still ends the same way for the person, and the slot comes back by expiry", async () => {
    seed({ freeUsedAt: [-20, -5], balance: 0 });
    releaseFails = true;
    askFarahChatStream.mockImplementationOnce(async function* () {
      throw new Error("provider down");
      yield "x";
    });
    const failed = await send();
    expect(failed.some((e) => e.type === "error")).toBe(true);
    expect(claimCount(), "the claim could not be released").toBe(1);
    expect(doneOf(await send()), "while it is held, a second request is not given the slot").toBeUndefined();
    vi.setSystemTime(new Date(NOW.getTime() + 121 * SECOND));
    releaseFails = false;
    expect(doneOf(await send()), "after the hold, the slot is free again").toBeDefined();
    expect(freeEvents()).toHaveLength(3);
  });

  it("a claim that expired before the reply finished is not recorded as a free message (the slot may already be someone else's): the reply is still delivered, and nothing is charged", async () => {
    seed({ freeUsedAt: [-20, -5], balance: 0 });
    askFarahChatStream.mockImplementationOnce(async function* () {
      yield "A slow reply.";
      vi.setSystemTime(new Date(NOW.getTime() + 130 * SECOND)); // the reply took longer than the hold
    });
    const done = doneOf(await send())!;
    expect(done).toBeDefined();
    expect(freeEvents(), "the late commit is refused, so the count stays at 2").toHaveLength(2);
    expect(spendCredits).not.toHaveBeenCalled();
    expect(claimCount()).toBe(0);
  });
});

describe("what the person sees does not change", () => {
  it("the free message that uses the last slot reports 0 left and the date, exactly as before the claim existed", async () => {
    seed({ freeUsedAt: [-20, -5], balance: 0 });
    const done = doneOf(await send())!;
    expect(done.freeMessagesRemaining).toBe(0);
    expect(done.nextFreeMessageAt).toBe(at(10));
  });

  it("a request that lost the race is refused with the same words and status as one whose free messages were simply used up", async () => {
    seed({ freeUsedAt: [-20, -5], balance: 0 });
    const [winner, loser] = await Promise.all([send(), send()]);
    void winner;
    const lostBody = JSON.stringify(loser);
    seed({ freeUsedAt: [-25, -20, -5], balance: 0 });
    const usedUpBody = JSON.stringify(await send());
    expect(lostBody).toBe(usedUpBody);
  });

  it("a message whose transcript fails to save still commits its free message once", async () => {
    seed({ freeUsedAt: [-20, -5], balance: 0 });
    persistFails = true;
    const done = doneOf(await send())!;
    expect(done).toMatchObject({ persisted: false, freeMessagesRemaining: 0 });
    expect(freeEvents()).toHaveLength(3);
  });
});
