/**
 * A PAID Farah message takes its credit AT THE CHECK and gives it back on every exit that is not a completed reply (audit 9 Oct, "Farah paid message race"). The real gate and the real chat route against a small
 * in-memory database; the credit balance is modelled as the database does it (one atomic conditional decrement), the model and the daily counter are faked.
 *
 * Why: the credit used to be spent AFTER the streamed reply, so two tabs at a balance of 1 both streamed a full reply and the loser's spend threw after it had been read (a free, unsaved reply). Now the loser is
 * refused at the check, before any model call. Every exit is named below: completed, model failure (before and part-way), empty reply, cut-off reply, the reader going away (before and during), an early
 * refusal after the check, an exception outside the stream, the loser of the race, plus the free path (unchanged), a Pass (unchanged) and a single paid message (charged once).
 * The residual window (a process killed between the spend and the release) cannot be tested here; it is stated in chat-gate.ts and made findable by the "[farah-paid-hold]" log lines tested at the end.
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
let historyMode: "ok" | "error" | "throw" = "ok";
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
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      if (name === "farah_messages" && !head && historyMode === "throw") return reject?.(new Error("history exploded"));
      if (name === "farah_messages" && !head && historyMode === "error") return resolve({ data: null, count: null, error: { message: "history unreadable", code: "XX000" } });
      const out = run();
      resolve(head ? { count: out.length, data: null, error: null } : { data: out, count: out.length, error: null });
    },
  };
  return api;
}
const releaseFails = false; // this file never makes the free-claim release fail (free-claim-end-to-end.test.ts does)
const fakeDb = () => ({
  from: (t: string) => query(t),
  // The claim functions of migration 0236, modelled rule by rule (tests/farah/support/free-claim-model.ts). `releaseFails` makes the release answer with an error, as a lost connection would.
  rpc: (fn: string, args: Record<string, unknown>) =>
    realRpcBuilder(releaseFails && fn === "release_farah_free_claim" ? { data: null, error: { message: "connection lost", code: "08006" } } : freeClaimRpc(store, fn, args, Date.now())),
  auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
});

let balanceNow = 0;
let refundFails = false;
class FakeInsufficient extends Error {
  constructor(public required: number, public available: number, public capMessage?: string) {
    super("insufficient");
  }
}
// spend_credits_atomic: ONE conditional decrement, so two callers cannot both take the last credit.
const spendCredits = vi.fn(async (...args: [user: string, amount: number, reason: string, entity?: string]) => {
  const amount = args[1];
  if (balanceNow < amount) throw new FakeInsufficient(amount, balanceNow);
  balanceNow -= amount;
  return balanceNow;
});
const grantCredits = vi.fn(async (...args: [user: string, amount: number, reason: string, entity?: string]) => {
  if (refundFails) throw new Error("ledger down");
  balanceNow += args[1];
  return balanceNow;
});
const askFarahChatStream = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeDb() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => fakeDb() }));
vi.mock("@/lib/credits/spend", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/credits/spend")>()), spendCredits, grantCredits, InsufficientCreditsError: FakeInsufficient }));
vi.mock("@/lib/farah/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/farah/client")>()), askFarahChatStream }));
vi.mock("@/lib/farah/session-events", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/farah/session-events")>()), logFarahSessionMessage: vi.fn(async () => undefined) }));
vi.mock("@/lib/farah/spend-tally", async () => (await import("./support/route-mocks")).safeSpendTally());

const { POST } = await import("@/app/api/farah/chat/route");
const { CREDIT_COSTS } = await import("@/lib/credits/costs");

function seed(opts: { freeUsedAt?: number[]; balance?: number; pass?: { expiresInDays: number } }) {
  for (const k of Object.keys(store)) delete store[k];
  balanceNow = opts.balance ?? 0;
  rows("profiles").push({ id: USER, get credits_balance() { return balanceNow; } });
  for (const d of opts.freeUsedAt ?? []) rows("credit_gate_events").push({ user_id: USER, reason: "farah_chat_message", outcome: "covered_by_free_allowance", created_at: at(d) });
  if (opts.pass) rows("user_passes").push({ id: "p1", user_id: USER, status: "active", expires_at: at(opts.pass.expiresInDays) });
}
const USED_UP = [-20, -10, -5]; // all three free messages used inside the window
async function send(signal?: AbortSignal): Promise<{ status: number; events: Array<Record<string, unknown>> }> {
  const res = await POST(new Request("http://localhost/api/farah/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Hello Farah, private words" }), signal }));
  const text = await res.text();
  const events = text.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => JSON.parse(l));
  return { status: res.status, events };
}
const doneOf = (events: Array<Record<string, unknown>>) => events.find((e) => e.type === "done");
const errorOf = (events: Array<Record<string, unknown>>) => events.find((e) => e.type === "error");
const claimCount = () => rows("farah_free_claims").length;
const freeEvents = () => rows("credit_gate_events").filter((r) => r.outcome === "covered_by_free_allowance");
const infoLines = () => (console.info as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
const errorLines = () => (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  persistFails = false;
  historyMode = "ok";
  refundFails = false;
  balanceNow = 0;
  nextId = 1;
  spendCredits.mockClear();
  grantCredits.mockClear();
  askFarahChatStream.mockReset().mockImplementation(async function* () {
    yield "A reply.";
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a single paid message", () => {
  it("is charged exactly once: one spend of 1, no refund, the balance goes down by 1, and the done event reports the ledger's balance", async () => {
    seed({ freeUsedAt: USED_UP, balance: 5 });
    const { events } = await send();
    expect(spendCredits).toHaveBeenCalledTimes(1);
    expect(spendCredits.mock.calls[0].slice(0, 3)).toEqual([USER, CREDIT_COSTS.farahChatMessage, "farah_chat_message"]);
    expect(grantCredits).not.toHaveBeenCalled();
    expect(balanceNow).toBe(4);
    expect(doneOf(events)?.creditsBalance).toBe(4);
    expect(rows("farah_messages")).toHaveLength(2);
  });
});

describe("exits that are not a completed reply give the credit back", () => {
  const expectGivenBack = (balance: number) => {
    expect(spendCredits).toHaveBeenCalledTimes(1);
    expect(grantCredits).toHaveBeenCalledTimes(1);
    expect(grantCredits.mock.calls[0].slice(0, 3)).toEqual(spendCredits.mock.calls[0].slice(0, 3));
    expect(grantCredits.mock.calls[0][3], "both ledger rows carry the same hold id").toBe(spendCredits.mock.calls[0][3]);
    expect(balanceNow, "the account ends where it started").toBe(balance);
    expect(rows("farah_messages")).toHaveLength(0);
  };

  it("model failure before the first token", async () => {
    seed({ freeUsedAt: USED_UP, balance: 5 });
    askFarahChatStream.mockImplementation(async function* () {
      throw new Error("provider down");
      yield "x";
    });
    const { events } = await send();
    expect(errorOf(events)).toBeDefined();
    expect(doneOf(events)).toBeUndefined();
    expectGivenBack(5);
  });

  it("model failure part-way through the reply", async () => {
    seed({ freeUsedAt: USED_UP, balance: 5 });
    askFarahChatStream.mockImplementation(async function* () {
      yield "half a rep";
      throw new Error("provider dropped");
    });
    const { events } = await send();
    expect(doneOf(events)).toBeUndefined();
    expectGivenBack(5);
  });

  it("an empty reply", async () => {
    seed({ freeUsedAt: USED_UP, balance: 5 });
    askFarahChatStream.mockImplementation(async function* () {
      /* nothing */
    });
    const { events } = await send();
    expect(errorOf(events)?.kind).toBe("empty_reply");
    expectGivenBack(5);
  });

  it("a reply cut off at the length cap: shown, saved as truncated, NOT charged; the done event leaves the masthead alone", async () => {
    seed({ freeUsedAt: USED_UP, balance: 5 });
    askFarahChatStream.mockImplementation(async function* (_t: unknown, _c: unknown, _m: unknown, opts?: { onFinish?: (r: string) => void }) {
      yield "cut o";
      opts?.onFinish?.("length");
    });
    const { events } = await send();
    const done = doneOf(events)!;
    expect(done.truncated).toBe(true);
    expect(done.creditsBalance).toBeNull();
    expect(spendCredits).toHaveBeenCalledTimes(1);
    expect(grantCredits).toHaveBeenCalledTimes(1);
    expect(balanceNow).toBe(5);
  });

  it("the reader goes away DURING the reply", async () => {
    seed({ freeUsedAt: USED_UP, balance: 5 });
    const ac = new AbortController();
    askFarahChatStream.mockImplementation(async function* () {
      yield "start";
      ac.abort();
      throw new Error("aborted");
    });
    await send(ac.signal);
    expectGivenBack(5);
  });

  it("the reader is already gone BEFORE the reply starts (the 499 exit)", async () => {
    seed({ freeUsedAt: USED_UP, balance: 5 });
    const ac = new AbortController();
    ac.abort();
    const { status } = await send(ac.signal);
    expect(status).toBe(499);
    expect(askFarahChatStream).not.toHaveBeenCalled();
    expectGivenBack(5);
  });

  it("an early refusal AFTER the check: the history cannot be read (500, no model call)", async () => {
    seed({ freeUsedAt: USED_UP, balance: 5 });
    historyMode = "error";
    const { status } = await send();
    expect(status).toBe(500);
    expect(askFarahChatStream).not.toHaveBeenCalled();
    expectGivenBack(5);
  });

  it("an exception outside the stream after the check (the wrapper releases and rethrows)", async () => {
    seed({ freeUsedAt: USED_UP, balance: 5 });
    historyMode = "throw";
    await expect(send()).rejects.toThrow(/history exploded/);
    expect(askFarahChatStream).not.toHaveBeenCalled();
    expectGivenBack(5);
  });

  it("a refund that FAILS does not crash the exit, and says so loudly (the one case an account is left a credit short)", async () => {
    seed({ freeUsedAt: USED_UP, balance: 5 });
    refundFails = true;
    askFarahChatStream.mockImplementation(async function* () {
      throw new Error("provider down");
      yield "x";
    });
    const { events } = await send();
    expect(errorOf(events)).toBeDefined();
    expect(grantCredits).toHaveBeenCalledTimes(1);
    expect(balanceNow).toBe(4);
    expect(errorLines().some((l) => /\[farah-paid-hold\] REFUND FAILED hold=/.test(l))).toBe(true);
  });
});

describe("the loser of a race for the last credit", () => {
  it("is refused at the check (402, needsCredits) BEFORE any model call or streaming: two parallel messages at a balance of 1 produce ONE reply and ONE model call, and nothing is refunded", async () => {
    seed({ freeUsedAt: USED_UP, balance: 1 });
    const both = await Promise.all([send(), send()]);
    const replies = both.filter((r) => doneOf(r.events));
    const refused = both.filter((r) => r.status === 402);
    expect(replies).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(JSON.stringify(refused[0].events)).toContain("needsCredits");
    expect(askFarahChatStream, "the loser never reached the model").toHaveBeenCalledTimes(1);
    expect(balanceNow).toBe(0);
    expect(grantCredits).not.toHaveBeenCalled();
    expect(rows("farah_messages")).toHaveLength(2);
  });

  it("ten at once at a balance of 3: exactly three replies, seven refused before the model, the balance ends at 0", async () => {
    seed({ freeUsedAt: USED_UP, balance: 3 });
    const all = await Promise.all(Array.from({ length: 10 }, () => send()));
    expect(all.filter((r) => doneOf(r.events))).toHaveLength(3);
    expect(all.filter((r) => r.status === 402)).toHaveLength(7);
    expect(askFarahChatStream).toHaveBeenCalledTimes(3);
    expect(balanceNow).toBe(0);
  });
});

describe("what does not change", () => {
  it("a FREE message takes no credit and never touches the ledger; it still gives its slot back on a failure", async () => {
    seed({ freeUsedAt: [-20, -5], balance: 5 });
    askFarahChatStream.mockImplementationOnce(async function* () {
      throw new Error("provider down");
      yield "x";
    });
    await send();
    expect(spendCredits).not.toHaveBeenCalled();
    expect(grantCredits).not.toHaveBeenCalled();
    expect(claimCount()).toBe(0);
    expect(freeEvents()).toHaveLength(2);
    const ok = doneOf((await send()).events)!;
    expect(ok.freeMessagesRemaining).toBe(0);
    expect(freeEvents()).toHaveLength(3);
    expect(spendCredits).not.toHaveBeenCalled();
    expect(balanceNow).toBe(5);
  });

  it("a Pass-covered message takes no credit", async () => {
    seed({ freeUsedAt: USED_UP, balance: 5, pass: { expiresInDays: 5 } });
    expect(doneOf((await send()).events)).toBeDefined();
    expect(spendCredits).not.toHaveBeenCalled();
    expect(grantCredits).not.toHaveBeenCalled();
    expect(balanceNow).toBe(5);
  });
});

describe("a paid hold can be followed afterwards", () => {
  it("a completed message writes a 'started' and a 'completed' line with the same hold id; a failed one writes 'started' and 'released'; no line carries the message text or the user id", async () => {
    seed({ freeUsedAt: USED_UP, balance: 5 });
    await send();
    askFarahChatStream.mockImplementationOnce(async function* () {
      throw new Error("provider down");
      yield "x";
    });
    await send();
    const lines = infoLines().filter((l) => l.startsWith("[farah-paid-hold]"));
    const id = (l: string) => /hold=([0-9a-f-]{36})/.exec(l)?.[1];
    const started = lines.filter((l) => l.includes(" started "));
    const completed = lines.filter((l) => l.includes(" completed "));
    const released = lines.filter((l) => l.includes(" released "));
    expect(started).toHaveLength(2);
    expect(completed).toHaveLength(1);
    expect(released).toHaveLength(1);
    expect(id(completed[0])).toBe(id(started[0]));
    expect(id(released[0])).toBe(id(started[1]));
    for (const l of lines) {
      expect(l).not.toContain("private words");
      expect(l).not.toContain(USER);
    }
  });
});
