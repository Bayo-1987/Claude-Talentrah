/**
 * The free-message allowance end to end, with the REAL gate, the REAL Pass check, the REAL gate-event log and the REAL routes, against a small in-memory database that applies the same filters the
 * queries ask for. Only the model, the credit spend and the ceiling tally are faked. This is what the module-boundary tests (next-free-message-wiring.test.ts) cannot show: that the time the routes
 * report is the one the stored events produce, and that a message which fails changes none of it.
 *
 * Time is fixed (Date only) so "30 days" is exact. The in-memory database implements eq / gt / gte / lte / is / in / order / limit / single / maybeSingle / insert and count-only selects; a query shape it
 * does not know throws, so a change to a query cannot pass by returning nothing.
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
const fakeDb = () => ({
  from: (t: string) => query(t),
  // The claim functions of migration 0236, modelled rule by rule (tests/farah/support/free-claim-model.ts).
  rpc: (fn: string, args: Record<string, unknown>) => realRpcBuilder(freeClaimRpc(store, fn, args, Date.now())),
  auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
});

const spendCredits = vi.fn(async () => 4);
const askFarahChatStream = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeDb() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => fakeDb() }));
vi.mock("@/lib/credits/spend", () => ({ spendCredits, InsufficientCreditsError: class InsufficientCreditsError extends Error { constructor(public required: number, public available: number, public capMessage?: string) { super("insufficient"); } } }));
vi.mock("@/lib/farah/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/farah/client")>()), askFarahChatStream }));
vi.mock("@/lib/farah/session-events", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/farah/session-events")>()), logFarahSessionMessage: vi.fn(async () => undefined) }));
vi.mock("@/lib/farah/spend-tally", async () => (await import("./support/route-mocks")).safeSpendTally());

const { POST } = await import("@/app/api/farah/chat/route");
const { GET } = await import("@/app/api/farah/history/route");
const { checkFarahChatAllowance } = await import("@/lib/farah/chat-gate");
const { hasActivePass } = await import("@/lib/passes/entitlement");
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
const history = async () => (await GET()).json() as Promise<Record<string, unknown>>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  persistFails = false;
  nextId = 1;
  spendCredits.mockClear();
  askFarahChatStream.mockReset().mockImplementation(async function* () {
    yield "A reply.";
  });
});
afterEach(() => vi.useRealTimers());

describe("the message that uses the LAST free one", () => {
  it("its done event carries the time: the oldest COUNTED free message in the window plus 30 days (a message older than the window is not counted)", async () => {
    seed({ freeUsedAt: [-31, -20, -5] }); // -31 days is outside the window: only -20 and -5 count, so this is the third free message
    const done = doneOf(await send())!;
    expect(done.freeMessagesRemaining).toBe(0);
    expect(done.nextFreeMessageAt).toBe(at(10)); // -20 days + 30 days
    expect(freeEvents()).toHaveLength(4); // the three seeded plus this one
    expect(spendCredits).not.toHaveBeenCalled();
  });

  it("and the very next request, now paid, reports the same time", async () => {
    seed({ freeUsedAt: [-20, -5], balance: 5 });
    await send();
    const next = doneOf(await send())!;
    expect(next.freeMessagesRemaining).toBe(0);
    expect(next.nextFreeMessageAt).toBe(at(10));
    expect(spendCredits).toHaveBeenCalledTimes(1);
  });

  it("a message that leaves free messages behind carries null (no read for it)", async () => {
    seed({ freeUsedAt: [-5] });
    const done = doneOf(await send())!;
    expect(done.freeMessagesRemaining).toBe(1);
    expect(done.nextFreeMessageAt).toBeNull();
  });
});

describe("a paid message whose transcript fails to save (the 'not saved' done event)", () => {
  it("is charged ONCE, still reports the right time, and writes no extra free-allowance event", async () => {
    seed({ freeUsedAt: [-25, -12, -3], balance: 5 });
    persistFails = true;
    const done = doneOf(await send())!;
    expect(done).toMatchObject({ type: "done", persisted: false, id: null, freeMessagesRemaining: 0 });
    expect(done.nextFreeMessageAt).toBe(at(5)); // -25 days + 30 days
    expect(spendCredits).toHaveBeenCalledTimes(1);
    expect(spendCredits).toHaveBeenCalledWith(USER, CREDIT_COSTS.farahChatMessage, "farah_chat_message");
    expect(freeEvents()).toHaveLength(3); // unchanged: a paid message is not a free one
  });
});

describe("an EXPIRED Pass, through the real Pass check (nothing about it is faked)", () => {
  it("the real check says there is no active Pass (the end date is in the past)", async () => {
    seed({ freeUsedAt: [], pass: { expiresInDays: -1 } });
    expect(await hasActivePass(USER)).toBe(false);
    seed({ freeUsedAt: [], pass: { expiresInDays: 3 } });
    expect(await hasActivePass(USER)).toBe(true);
  });

  it("a Pass that is not active (status cancelled) is not active even with an end date in the future", async () => {
    seed({ freeUsedAt: [], pass: { expiresInDays: 3, status: "cancelled" } });
    expect(await hasActivePass(USER)).toBe(false);
  });

  it("free messages left: a free message is used, as for anyone", async () => {
    seed({ freeUsedAt: [-2], balance: 0, pass: { expiresInDays: -1 } });
    const a = await checkFarahChatAllowance(USER);
    expect(a).toMatchObject({ isFreeAllowance: true, isPassCovered: false, freeMessagesRemaining: 1 });
  });

  it("free messages used up, enough credits: credits are charged, not a Pass", async () => {
    seed({ freeUsedAt: [-25, -12, -3], balance: 5, pass: { expiresInDays: -1 } });
    const a = await checkFarahChatAllowance(USER);
    expect(a).toMatchObject({ isFreeAllowance: false, isPassCovered: false, creditsSpent: CREDIT_COSTS.farahChatMessage });
  });

  it("free messages used up, no credits: refused, exactly as with no Pass at all", async () => {
    seed({ freeUsedAt: [-25, -12, -3], balance: 0, pass: { expiresInDays: -1 } });
    await expect(checkFarahChatAllowance(USER)).rejects.toThrow();
  });

  it("the history response shows a number of free messages (never the null a Pass holder gets) and a time", async () => {
    seed({ freeUsedAt: [-25, -12, -3], balance: 0, pass: { expiresInDays: -1 } });
    const body = await history();
    expect(body.freeMessagesRemaining).toBe(0);
    expect(body.nextFreeMessageAt).toBe(at(5));
  });

  it("whereas the same account with an ACTIVE Pass is covered and shows null for both", async () => {
    seed({ freeUsedAt: [-25, -12, -3], balance: 0, pass: { expiresInDays: 3 } });
    expect(await checkFarahChatAllowance(USER)).toMatchObject({ isPassCovered: true });
    const body = await history();
    expect(body.freeMessagesRemaining).toBeNull();
    expect(body.nextFreeMessageAt).toBeNull();
  });
});

describe("a message whose model call FAILS leaves everything as it was", () => {
  it("no commit, no free-allowance event, no done event; and the next request reports the same time as before", async () => {
    seed({ freeUsedAt: [-25, -12, -3], balance: 5 });
    const before = (await history()).nextFreeMessageAt;
    expect(before).toBe(at(5));
    const eventsBefore = rows("credit_gate_events").length;

    askFarahChatStream.mockImplementation(async function* () {
      throw new Error("provider down");
      yield "x";
    });
    const failed = await send();
    expect(doneOf(failed)).toBeUndefined();
    expect(failed.some((e) => e.type === "error")).toBe(true);
    expect(spendCredits).not.toHaveBeenCalled();
    expect(freeEvents()).toHaveLength(3);
    // The gate may log a 'proceeded' check for a paid message only at CHECK time for credits; no free-allowance event and no charge exist.
    expect(rows("credit_gate_events").filter((r) => r.outcome === "covered_by_free_allowance")).toHaveLength(3);
    expect(rows("farah_messages")).toHaveLength(0);
    expect((await history()).nextFreeMessageAt).toBe(before);

    askFarahChatStream.mockImplementation(async function* () {
      yield "A reply.";
    });
    const ok = doneOf(await send())!;
    expect(ok.nextFreeMessageAt).toBe(before);
    expect(spendCredits).toHaveBeenCalledTimes(1);
    expect(eventsBefore).toBe(3);
  });

  it("a failed message when a free one was still left: that free message is still left afterwards", async () => {
    seed({ freeUsedAt: [-25, -12], balance: 0 });
    askFarahChatStream.mockImplementation(async function* () {
      throw new Error("provider down");
      yield "x";
    });
    await send();
    expect(freeEvents()).toHaveLength(2);
    expect((await history()).freeMessagesRemaining).toBe(1);
    expect((await history()).nextFreeMessageAt).toBeNull();
  });
});

describe("OVER-COMMITTED: more than 3 free messages inside the window (parallel requests can do this today; it is characterised by chat-gate-concurrent-commit.test.ts and NOT fixed here)", () => {
  it("history, 4 in the window: the date is when the SECOND oldest leaves, the first moment a message is free again, not when the oldest leaves", async () => {
    seed({ freeUsedAt: [-25, -20, -10, -5], balance: 0 });
    const body = await history();
    expect(body.freeMessagesRemaining).toBe(0);
    expect(body.nextFreeMessageAt).toBe(at(10)); // -20 days + 30. At day 5 (-25 + 30) the window would still hold 3: not free.
  });

  it("the promise holds through the real gate: a free message is NOT available one millisecond before the reported time and IS available one millisecond after it", async () => {
    // The reported instant is the moment the oldest blocking message turns exactly 30 days old; the gate still counts a message that is exactly 30 days old (created_at >= now - 30 days), so it is free from the next millisecond.
    seed({ freeUsedAt: [-25, -20, -10, -5], balance: 0 });
    const promised = new Date(String((await history()).nextFreeMessageAt));
    // The claim is made by the database on ITS clock, which in this file is the faked Date: move that clock too, not only the gate's `now` argument.
    vi.setSystemTime(new Date(promised.getTime() - 1));
    await expect(checkFarahChatAllowance(USER, new Date(promised.getTime() - 1))).rejects.toThrow(); // no free left, no credits, no Pass
    vi.setSystemTime(new Date(promised.getTime() + 1));
    expect(await checkFarahChatAllowance(USER, new Date(promised.getTime() + 1))).toMatchObject({ isFreeAllowance: true, freeMessagesRemaining: 0 }); // free: 2 counted, this message is the third (0 left after it)
  });

  it("5 in the window: the third oldest decides", async () => {
    seed({ freeUsedAt: [-28, -25, -20, -10, -5], balance: 0 });
    expect((await history()).nextFreeMessageAt).toBe(at(10));
  });

  it("many more than 3 in the window (60): still the (n - 3 + 1)th oldest, with no bound on how many there are", async () => {
    const days = Array.from({ length: 60 }, (_, i) => -29 + i * 0.4); // 60 events from 29 days ago up to about 5 days ago, oldest first
    seed({ freeUsedAt: days, balance: 0 });
    const sorted = days.map((d) => at(d)).sort();
    const expected = new Date(new Date(sorted[60 - 3]).getTime() + 30 * DAY).toISOString(); // row n - 3 + 1 (1-based) is the 3rd newest
    expect((await history()).nextFreeMessageAt).toBe(expected);
  });

  it("ties: four events at one instant and one newer: the date is that instant plus 30 days", async () => {
    seed({ freeUsedAt: [-20, -20, -20, -20, -2], balance: 0 });
    expect((await history()).nextFreeMessageAt).toBe(at(10));
  });

  it("the message that goes over (4 free ones in the window after it commits) reports the same corrected time in its done event", async () => {
    seed({ freeUsedAt: [-25, -20, -10, -5] , balance: 5 });
    const done = doneOf(await send())!; // credits pay: the free count is already used up, so nothing new is committed as free
    expect(done.freeMessagesRemaining).toBe(0);
    expect(done.nextFreeMessageAt).toBe(at(10));
  });

  it("four requests in parallel against 2 used messages can no longer push the count past 3: one is free, the rest are refused here (no credits), and the count stays at 3", async () => {
    seed({ freeUsedAt: [-20, -5], balance: 0 });
    const outcomes = await Promise.all([send(), send(), send(), send()]);
    const freeReplies = outcomes.filter((events) => doneOf(events));
    expect(freeReplies, "exactly the one free slot was granted").toHaveLength(1);
    expect(freeEvents()).toHaveLength(3);
    expect(rows("farah_free_claims"), "no pending claim is left behind").toHaveLength(0);
    expect((await history()).nextFreeMessageAt).toBe(at(10));
  });
});

