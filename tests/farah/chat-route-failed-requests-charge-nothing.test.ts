/**
 * MONEY CLAIM, checked: a chat request that fails uses no free message and no credit.
 *
 * The panel shows "That reply didn't go through, and nothing was charged." (src/lib/farah/failure-note.ts) on a failed request. Before that line ships for 401, 429, the 503 "resting" answer, 5xx and the
 * other non-2xx answers, this shows by test, on the REAL route and the REAL gate (only the model, the credit spend, the daily counter and a small in-memory database are faked), that on every one of those
 * paths no free-allowance event was written, no credit was spent and no Pass use was logged. It also shows WHY that holds, so it cannot quietly stop holding:
 *
 *   - every refusal the route can answer with a non-2xx status is answered BEFORE the `new ReadableStream(...)` that carries the reply, and the charge is committed only INSIDE that stream, after the model's
 *     reply completed. A response's status is fixed when the Response is created, so a request that was charged ALWAYS has status 200: there is no path where the reply succeeded, the commit ran and the
 *     client still sees a non-2xx status (source scan below, plus the control).
 *   - the one way a charged request can still look broken to a client is a stream that dies AFTER the status line (a dropped connection, a platform timeout); that is why the failure note is never for a
 *     dropped connection (failure-note.ts), and why this file does not claim it for a 200 stream.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const NOW = new Date("2026-10-31T12:00:00.000Z");
const USER = "11111111-1111-1111-1111-111111111111";

const store: Record<string, Row[]> = {};
let signedIn = true;
let failHourlyCount = false;
let failHistoryRead = false;
let spentNano = 0;
let counterThrows = false;
let sessionLogThrows = false;
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
      const made = (Array.isArray(row) ? row : [row]).map((r) => ({ id: `id-${nextId++}`, created_at: new Date().toISOString(), ...r }));
      rows(name).push(...made);
      const result = { data: made[0], error: null };
      const b: Record<string, unknown> = { select: () => b, single: async () => result, then: (resolve: (v: unknown) => void) => resolve(result) };
      return b;
    },
    then: (resolve: (v: unknown) => void) => {
      if (name === "farah_messages" && head && failHourlyCount) return resolve({ count: null, data: null, error: { message: "boom", code: "XX000" } });
      if (name === "farah_messages" && !head && failHistoryRead) return resolve({ count: null, data: null, error: { message: "boom", code: "XX000" } });
      const out = run();
      resolve(head ? { count: out.length, data: null, error: null } : { data: out, count: out.length, error: null });
    },
  };
  return api;
}
const fakeDb = () => ({ from: (t: string) => query(t), auth: { getUser: async () => ({ data: { user: signedIn ? { id: USER } : null } }) } });

const spendCredits = vi.fn(async () => 4);
const askFarahChatStream = vi.fn();
const logFarahSessionMessage = vi.fn(async () => {
  if (sessionLogThrows) throw new Error("session log down");
});
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeDb() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => fakeDb() }));
vi.mock("@/lib/credits/spend", () => ({ spendCredits, InsufficientCreditsError: class InsufficientCreditsError extends Error { constructor(public required: number, public available: number, public capMessage?: string) { super("insufficient"); } } }));
vi.mock("@/lib/farah/client", () => ({ askFarahChatStream }));
vi.mock("@/lib/farah/session-events", () => ({ logFarahSessionMessage }));
vi.mock("@/lib/farah/spend-tally", () => ({
  readSpendNano: async () => {
    if (counterThrows) throw new Error("counter down");
    return spentNano;
  },
  addSpendNano: async (n: number) => (spentNano += n),
  markHalfwayWarned: async () => false,
}));

const { POST } = await import("@/app/api/farah/chat/route");
const { NANO_PER_USD, DEFAULT_DAILY_CEILING_USD } = await import("@/lib/farah/spend-ceiling");
const { NOTHING_CHARGED_STATUSES } = await import("@/lib/farah/failure-note");

const freeEvents = () => rows("credit_gate_events").filter((r) => r.outcome === "covered_by_free_allowance");
const passEvents = () => rows("credit_gate_events").filter((r) => r.outcome === "covered_by_pass");
function seed(opts: { freeUsed?: number; balance?: number } = {}) {
  for (const k of Object.keys(store)) delete store[k];
  rows("profiles").push({ id: USER, credits_balance: opts.balance ?? 5 });
  for (let i = 0; i < (opts.freeUsed ?? 0); i += 1) rows("credit_gate_events").push({ user_id: USER, reason: "farah_chat_message", outcome: "covered_by_free_allowance", created_at: new Date(NOW.getTime() - (i + 2) * 86_400_000).toISOString() });
}
const request = (body: unknown = { message: "Hello" }, signal?: AbortSignal) =>
  new Request("http://localhost/api/farah/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body), signal });

/** Everything that would mean a message was USED: a free-allowance event, a Pass-use event, a credit spend. (A 'blocked' funnel row is a log of a refusal, not a use.) */
/** The statuses this file has SEEN the route answer with while it checked that nothing was used. The allowlist of statuses the panel may add the failure note for is held to this set at the end of the file. */
const provenChargeFree = new Set<number>();

function used() {
  return { freeEvents: freeEvents().length, passEvents: passEvents().length, creditSpends: spendCredits.mock.calls.length };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  signedIn = true;
  failHourlyCount = false;
  failHistoryRead = false;
  spentNano = 0;
  counterThrows = false;
  sessionLogThrows = false;
  nextId = 1;
  spendCredits.mockClear();
  logFarahSessionMessage.mockClear();
  askFarahChatStream.mockReset().mockImplementation(async function* () {
    yield "A reply.";
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CONTROL: a request that succeeds IS charged, so the assertions below can fail", () => {
  it("a free message is recorded and a paid one spends its credit, both with status 200", async () => {
    seed({ freeUsed: 0 });
    const free = await POST(request());
    expect(free.status).toBe(200);
    await free.text();
    expect(used()).toEqual({ freeEvents: 1, passEvents: 0, creditSpends: 0 });

    seed({ freeUsed: 3, balance: 5 });
    spendCredits.mockClear();
    const paid = await POST(request());
    expect(paid.status).toBe(200);
    await paid.text();
    expect(used().creditSpends).toBe(1);
  });
});

describe("every non-2xx answer the route gives leaves everything unused", () => {
  const cases: Array<{ name: string; status: number; setup: () => void; req?: () => Request }> = [
    { name: "401: not signed in", status: 401, setup: () => ((signedIn = false), seed({ freeUsed: 0 })) },
    { name: "400: no message", status: 400, setup: () => seed({ freeUsed: 0 }), req: () => request({ message: "   " }) },
    { name: "400: a message over the length limit", status: 400, setup: () => seed({ freeUsed: 0 }), req: () => request({ message: "x".repeat(2001) }) },
    { name: "400: a body that is not JSON", status: 400, setup: () => seed({ freeUsed: 0 }), req: () => request("not json") },
    { name: "429: the hourly message cap", status: 429, setup: () => {
      seed({ freeUsed: 0 });
      for (let i = 0; i < 30; i += 1) rows("farah_messages").push({ user_id: USER, role: "user", content: "x", created_at: NOW.toISOString() });
    } },
    { name: "402: free messages used up and not enough credits", status: 402, setup: () => seed({ freeUsed: 3, balance: 0 }) },
    { name: "503: Farah is resting (the daily ceiling is reached)", status: 503, setup: () => ((spentNano = Math.round(DEFAULT_DAILY_CEILING_USD * NANO_PER_USD)), seed({ freeUsed: 0 })) },
    { name: "503: the daily counter cannot be read (it fails closed)", status: 503, setup: () => ((counterThrows = true), seed({ freeUsed: 0 })) },
    { name: "500: the hourly count cannot be read", status: 500, setup: () => ((failHourlyCount = true), seed({ freeUsed: 0 })) },
    { name: "500: the history cannot be read, AFTER the gate has said a free message is left", status: 500, setup: () => ((failHistoryRead = true), seed({ freeUsed: 0 })) },
    { name: "500: the history cannot be read, AFTER the gate has priced a credit message", status: 500, setup: () => ((failHistoryRead = true), seed({ freeUsed: 3, balance: 5 })) },
  ];
  for (const c of cases) {
    it(`${c.name}: status ${c.status}, no model call, no free message, no Pass use, no credit`, async () => {
      c.setup();
      const freeBefore = () => (c.name.startsWith("402") || c.name.includes("priced a credit") ? 3 : 0);
      const res = await POST((c.req ?? (() => request()))());
      expect(res.status).toBe(c.status);
      await res.text();
      expect(askFarahChatStream).not.toHaveBeenCalled();
      expect(used()).toEqual({ freeEvents: freeBefore(), passEvents: 0, creditSpends: 0 }); // the free events there already were (seeded), no more
      provenChargeFree.add(res.status); // reached only if every assertion above held
    });
  }

  it("499: a request already aborted when the model call would start: no model call, nothing used", async () => {
    seed({ freeUsed: 0 });
    const controller = new AbortController();
    controller.abort();
    const res = await POST(request({ message: "Hello" }, controller.signal));
    expect(res.status).toBe(499);
    expect(askFarahChatStream).not.toHaveBeenCalled();
    expect(used()).toEqual({ freeEvents: 0, passEvents: 0, creditSpends: 0 });
    provenChargeFree.add(499);
  });

  it("an UNEXPECTED exception before the reply starts (the route throws, the platform answers 5xx): nothing is used", async () => {
    seed({ freeUsed: 0 });
    sessionLogThrows = true;
    await expect(POST(request({ message: "Hello", sessionId: "s-1" }))).rejects.toThrow("session log down");
    expect(askFarahChatStream).not.toHaveBeenCalled();
    expect(used()).toEqual({ freeEvents: 0, passEvents: 0, creditSpends: 0 });
  });
});

describe("a reply that FAILS after the request was accepted (status 200, an error event in the stream) uses nothing either", () => {
  for (const [name, model] of [
    ["the model throws before the first token", async function* () { throw new Error("provider down"); yield "x"; }],
    ["the model fails part-way through", async function* () { yield "A start, "; throw new Error("connection reset"); }],
    ["the model returns nothing", async function* () { /* no chunks */ }],
  ] as const) {
    it(`${name}: no free message, no credit (free path and paid path)`, async () => {
      for (const seedOpts of [{ freeUsed: 0 }, { freeUsed: 3, balance: 5 }]) {
        seed(seedOpts);
        spendCredits.mockClear();
        askFarahChatStream.mockReset().mockImplementation(model);
        const res = await POST(request());
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text).toContain('"type":"error"');
        expect(text).not.toContain('"type":"done"');
        expect(used()).toEqual({ freeEvents: seedOpts.freeUsed, passEvents: 0, creditSpends: 0 });
      }
    });
  }
});

describe("WHY it holds: the status is fixed before the charge, and the charge is only inside the reply stream", () => {
  const src = readFileSync(join(__dirname, "../../src/app/api/farah/chat/route.ts"), "utf8");
  const streamStart = src.indexOf("new ReadableStream");
  const commitCall = src.indexOf("commitFarahChatAllowance(user.id");

  it("the route constructs its reply stream, and the commit is called exactly once, inside it (after the stream is constructed)", () => {
    expect(streamStart).toBeGreaterThan(0);
    expect(commitCall).toBeGreaterThan(streamStart);
    expect((src.match(/commitFarahChatAllowance\(/g) ?? []).length).toBe(1);
  });

  it("every non-2xx status the route answers with sits BEFORE the stream; the streamed Response sets none (so it is 200)", () => {
    const before = src.slice(0, streamStart);
    const after = src.slice(streamStart);
    const statuses = (t: string) => [...t.matchAll(/status:\s*(\d{3})/g)].map((m) => Number(m[1]));
    expect(statuses(before).length).toBeGreaterThan(5);
    expect(statuses(after), "no status is chosen after the stream starts").toEqual([]);
    const response = after.slice(after.indexOf("return new Response(stream"));
    expect(response).not.toMatch(/status/);
  });

  it("every 'error' event the stream sends sits BEFORE the commit: a person who is shown the failure note on an error event can never have been charged", () => {
    const errorSends = [...src.matchAll(/send\(\{ type: "error"/g)].map((m) => m.index!);
    expect(errorSends.length).toBeGreaterThanOrEqual(3);
    for (const at of errorSends) expect(at, "an error event is sent after the charge was committed").toBeLessThan(commitCall);
  });

  it("the credit spend and the free-allowance event are written only by the commit (nothing else in the route calls them)", () => {
    expect(src).not.toMatch(/spendCredits|logCreditGateEvent/);
  });
});

describe("the allowlist of statuses the panel may show 'nothing was charged' for (NOTHING_CHARGED_STATUSES, failure-note.ts) holds only proven statuses", () => {
  it("it is a plain list of whole HTTP error statuses, with no duplicates", () => {
    expect(Array.isArray(NOTHING_CHARGED_STATUSES)).toBe(true);
    for (const status of NOTHING_CHARGED_STATUSES) expect(Number.isInteger(status) && status >= 400 && status <= 599, String(status)).toBe(true);
    expect(new Set(NOTHING_CHARGED_STATUSES).size).toBe(NOTHING_CHARGED_STATUSES.length);
  });

  for (const status of NOTHING_CHARGED_STATUSES) {
    it(`status ${status} is listed, and this file saw the route answer ${status} with no free message, no Pass use, no credit used (the proof)`, () => {
      expect(provenChargeFree.has(status), `${status} is on the allowlist without a proof in this file`).toBe(true);
    });
  }

  it("the list contains no status without a proof: every listed status was observed charge-free above", () => {
    const unproven = NOTHING_CHARGED_STATUSES.filter((status) => !provenChargeFree.has(status));
    expect(unproven).toEqual([]);
  });

  it("402 (its own message already says it) and 499 (the reader went away: nothing is shown) are proven here but deliberately not on the list; no 2xx is ever on it", () => {
    expect(provenChargeFree.has(402) && provenChargeFree.has(499)).toBe(true);
    expect(NOTHING_CHARGED_STATUSES).not.toContain(402);
    expect(NOTHING_CHARGED_STATUSES).not.toContain(499);
    expect(NOTHING_CHARGED_STATUSES.some((status) => status < 400)).toBe(false);
  });

  it("a status this file could not prove is not on it: the gateway and platform statuses (502, 504) are not the route's own answers and are left off", () => {
    expect(NOTHING_CHARGED_STATUSES).not.toContain(502);
    expect(NOTHING_CHARGED_STATUSES).not.toContain(504);
    expect(provenChargeFree.has(502) || provenChargeFree.has(504)).toBe(false);
  });
});
