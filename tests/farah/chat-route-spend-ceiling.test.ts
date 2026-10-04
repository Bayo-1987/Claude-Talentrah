/**
 * Farah chat and the daily spend ceiling (S3-82/83), at the ROUTE. Mocks at the module boundary only, like chat-route-length-stop.test.ts: the model
 * call, the gate, Supabase, and the spend tally (`@/lib/farah/spend-tally`: readSpendNano(), addSpendNano(nano), markHalfwayWarned()). The tally has
 * no day argument: the day is the database's (migration 0223), so the app cannot disagree with the counter about which day it is.
 *
 *   (a) under the ceiling the request passes through;
 *   (b) at the ceiling: HTTP 503, code "farah_daily_ceiling", the friendly text, a Retry-After; no model call, no gate, nothing saved or charged;
 *   (c) Retry-After is the time to the next UTC midnight, from the app clock;
 *   (d) a missing or invalid FARAH_DAILY_SPEND_CEILING_USD uses the default constant (never "no limit"); no expectation here hardcodes its value;
 *   (e) a failure reading the tally fails CLOSED with its own code, "farah_spend_unavailable" (distinct from the ceiling, the limiter and persisted:false);
 *   recording (counts priced per model; unknown or failover models at the most expensive row; flat estimates only without counts; an aborted
 *   attempt estimated and never charged to the user; nothing added when no model call happened); and two content-free log lines with distinct tags
 *   (ceiling reached; counter failure) beside the 50% one. The rest of the site is unaffected: only this route reads the tally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LLMProviderError } from "@/lib/llm";
import { loadModule } from "../support/load-module";

const getUser = vi.fn();
const checkFarahChatAllowance = vi.fn();
const commitFarahChatAllowance = vi.fn();
const askFarahChatStream = vi.fn();
const readSpendNano = vi.fn();
const addSpendNano = vi.fn();
const markHalfwayWarned = vi.fn();
const inserted: Array<Record<string, unknown>> = [];

function chainable(chainResult: Record<string, unknown>, singleResult?: Record<string, unknown>): unknown {
  const proxy: object = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(chainResult);
        if (prop === "maybeSingle" || prop === "single") return async () => singleResult ?? chainResult;
        return () => proxy;
      },
    },
  );
  return proxy;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from(table: string) {
      if (table === "farah_messages") {
        const reads = chainable({ count: 0, data: [], error: null });
        const insertOk = chainable({ data: { id: "m1", created_at: "2026-01-01T00:00:00.000Z" }, error: null });
        return new Proxy(reads as object, {
          get(target, prop, receiver) {
            if (prop === "insert")
              return (row: Record<string, unknown>) => {
                inserted.push(row);
                return insertOk;
              };
            return Reflect.get(target, prop, receiver);
          },
        });
      }
      return chainable({ data: null, error: null });
    },
  }),
}));
vi.mock("@/lib/farah/client", () => ({ askFarahChatStream }));
vi.mock("@/lib/farah/session-events", () => ({ logFarahSessionMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/farah/chat-gate", () => ({
  checkFarahChatAllowance,
  commitFarahChatAllowance,
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));
vi.mock("@/lib/farah/spend-tally", () => ({ readSpendNano, addSpendNano, markHalfwayWarned }));
const { POST } = await import("@/app/api/farah/chat/route");

const ENV = "FARAH_DAILY_SPEND_CEILING_USD";
const FREE = { isFreeAllowance: true, isPassCovered: false, creditsSpent: 0, creditsAvailableAtCheck: 41, freeMessagesRemaining: 2 };
const MESSAGE = "A distinctive question about my résumé 7f3a";
const request = () => new Request("http://localhost/api/farah/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: MESSAGE }) });
const wait = () => new Promise((r) => setTimeout(r, 10));
interface SpendMod {
  DEFAULT_DAILY_CEILING_USD: number;
  NANO_PER_USD: number;
  FAILED_ATTEMPT_ESTIMATE_NANO: number;
  NO_COUNTS_REPLY_ESTIMATE_NANO: number;
  secondsUntilUtcMidnight(d: Date): number;
}
const spend = () => loadModule<SpendMod>("@/lib/farah/spend-ceiling");
/** The ceiling in nano-dollars when the environment variable is unset: derived from the ONE default constant, never typed here. */
const ceilingNano = async () => {
  const m = await spend();
  return Math.round(m.DEFAULT_DAILY_CEILING_USD * m.NANO_PER_USD);
};
const INTERNAL_ERROR_TEXT = "failed on internal-db-7 while reading the usage table";
const spendLines = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith("[farah-spend"));
let savedEnv: string | undefined;
let warn: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  inserted.length = 0;
  savedEnv = process.env[ENV];
  delete process.env[ENV];
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "route-test-user" } } });
  checkFarahChatAllowance.mockReset().mockResolvedValue(FREE);
  commitFarahChatAllowance.mockReset().mockResolvedValue({ balanceAfter: null });
  askFarahChatStream.mockReset().mockImplementation(async function* () {
    yield "A reply.";
  });
  readSpendNano.mockReset().mockResolvedValue(0);
  addSpendNano.mockReset().mockResolvedValue(0);
  markHalfwayWarned.mockReset().mockResolvedValue(true);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (savedEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = savedEnv;
});

describe("signed-out requests never touch the counter", () => {
  it("401 before any spend read", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(readSpendNano).not.toHaveBeenCalled();
  });
});

describe("(a) under the ceiling the request passes through", () => {
  it("calls the model, commits the charge and saves the exchange", async () => {
    readSpendNano.mockResolvedValue((await ceilingNano()) / 2 - 1);
    const res = await POST(request());
    expect(res.status).toBe(200);
    await res.text();
    expect(askFarahChatStream).toHaveBeenCalledTimes(1);
    expect(commitFarahChatAllowance).toHaveBeenCalledTimes(1);
    expect(inserted.length).toBe(2);
  });
});

describe("(b) at the ceiling: a distinct, friendly response, and nothing else happens", () => {
  for (const multiple of [1, 2.5]) {
    it(`spent ${multiple}x the ceiling: 503, code farah_daily_ceiling, the exact friendly text, a Retry-After; no model call, no gate, nothing saved or charged`, async () => {
      readSpendNano.mockResolvedValue((await ceilingNano()) * multiple);
      const res = await POST(request());
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "Farah is resting for today. Please try again tomorrow.", code: "farah_daily_ceiling" });
      const retry = Number(res.headers.get("Retry-After"));
      expect(Number.isInteger(retry) && retry >= 1 && retry <= 86400).toBe(true);
      expect(askFarahChatStream).not.toHaveBeenCalled();
      expect(checkFarahChatAllowance).not.toHaveBeenCalled();
      expect(commitFarahChatAllowance).not.toHaveBeenCalled();
      expect(inserted).toEqual([]);
      expect(addSpendNano).not.toHaveBeenCalled();
    });
  }

  it("the response is not persisted:false and not a stream: it is a plain JSON refusal before any streaming starts", async () => {
    readSpendNano.mockResolvedValue(await ceilingNano());
    const res = await POST(request());
    expect(res.headers.get("Content-Type")).toMatch(/application\/json/);
    expect(JSON.stringify(await res.json())).not.toMatch(/persisted/);
  });

  it("writes ONE content-free line tagged [farah-spend:ceiling]: no message text, no user id, no amounts tied to a person", async () => {
    readSpendNano.mockResolvedValue(await ceilingNano());
    await POST(request());
    const lines = [...spendLines(warn), ...spendLines(errorSpy)];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[farah-spend:ceiling\]/);
    expect(lines[0]).not.toContain(MESSAGE);
    expect(lines[0]).not.toContain("route-test-user");
  });
});

describe("(c) Retry-After is the time to the next UTC midnight", () => {
  it("23:59:30 UTC gives 30 seconds; 00:00:00 UTC gives a full day", async () => {
    readSpendNano.mockResolvedValue(await ceilingNano());
    const m = await spend();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T23:59:30Z"));
    const late = await POST(request());
    expect(late.headers.get("Retry-After")).toBe("30");
    expect(m.secondsUntilUtcMidnight(new Date("2026-10-04T23:59:30Z"))).toBe(30);
    vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
    const early = await POST(request());
    expect(early.headers.get("Retry-After")).toBe("86400");
  });

  it("the route does not pass a day to the counter (the database decides the day)", async () => {
    await (await POST(request())).text();
    expect(readSpendNano).toHaveBeenCalledTimes(1);
    expect(readSpendNano.mock.calls[0]).toEqual([]);
    expect(addSpendNano).toHaveBeenCalledTimes(1);
    expect(addSpendNano.mock.calls[0]).toHaveLength(1);
  });
});

describe("(d) a missing or invalid setting uses the default constant, never 'no limit'", () => {
  for (const value of [undefined, "", "abc", "-1", "0", "NaN", "Infinity"]) {
    it(`FARAH_DAILY_SPEND_CEILING_USD=${JSON.stringify(value)}: one nano-dollar under the default passes and the default itself blocks`, async () => {
      if (value !== undefined) process.env[ENV] = value;
      const ceiling = await ceilingNano();
      readSpendNano.mockResolvedValue(ceiling - 1);
      const ok = await POST(request());
      expect(ok.status).toBe(200);
      await ok.text();
      readSpendNano.mockResolvedValue(ceiling);
      expect((await POST(request())).status).toBe(503);
    });
  }

  it("a valid setting moves the line", async () => {
    const m = await spend();
    const d = m.DEFAULT_DAILY_CEILING_USD;
    const ceiling = await ceilingNano();
    process.env[ENV] = String(d / 2);
    readSpendNano.mockResolvedValue(ceiling / 2);
    expect((await POST(request())).status).toBe(503);
    process.env[ENV] = String(d * 2);
    readSpendNano.mockResolvedValue(ceiling * 1.5);
    const ok = await POST(request());
    expect(ok.status).toBe(200);
    await ok.text();
  });
});

describe("(e) a failure reading the tally fails CLOSED, with its own code", () => {
  it("503, code farah_spend_unavailable, its own text and a short Retry-After; no model call, no gate, nothing saved or charged", async () => {
    readSpendNano.mockRejectedValue(new Error("db down"));
    const res = await POST(request());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Farah can't check today's capacity just now. Try again shortly.", code: "farah_spend_unavailable" });
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(askFarahChatStream).not.toHaveBeenCalled();
    expect(checkFarahChatAllowance).not.toHaveBeenCalled();
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it("its code differs from the ceiling's (and from anything the limiter will use)", async () => {
    readSpendNano.mockRejectedValue(new Error("x"));
    const failed = await (await POST(request())).json();
    readSpendNano.mockReset().mockResolvedValue(await ceilingNano());
    const ceiling = await (await POST(request())).json();
    expect(failed.code).not.toBe(ceiling.code);
    expect(failed.error).not.toBe(ceiling.error);
  });

  it("writes ONE content-free line tagged [farah-spend:counter-failed]: not the error's text, not the message, not the user id", async () => {
    readSpendNano.mockRejectedValue(Object.assign(new Error(INTERNAL_ERROR_TEXT), { code: "57014" }));
    await POST(request());
    const lines = [...spendLines(warn), ...spendLines(errorSpy)];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[farah-spend:counter-failed\]/);
    expect(lines[0]).not.toContain(INTERNAL_ERROR_TEXT);
    expect(lines[0]).not.toContain("internal-db-7");
    expect(lines[0]).not.toContain(MESSAGE);
    expect(lines[0]).not.toContain("route-test-user");
  });

  it("the two tags are different, so an operator can tell 'ceiling reached' from 'counter broken' by the tag alone", async () => {
    readSpendNano.mockRejectedValue(new Error("x"));
    await POST(request());
    const failedTag = [...spendLines(warn), ...spendLines(errorSpy)][0]?.match(/^\[[^\]]+\]/)?.[0];
    warn.mockClear();
    errorSpy.mockClear();
    readSpendNano.mockReset().mockResolvedValue(await ceilingNano());
    await POST(request());
    const ceilingTag = [...spendLines(warn), ...spendLines(errorSpy)][0]?.match(/^\[[^\]]+\]/)?.[0];
    expect(failedTag).toBeTruthy();
    expect(ceilingTag).toBeTruthy();
    expect(failedTag).not.toBe(ceilingTag);
  });
});

describe("recording the spend (an estimate from token counts and published prices)", () => {
  const usage = { inputTokens: 2400, outputTokens: 470, totalTokens: 2870, reasoningTokens: null };
  const served = (provider: string, model: string) => ({ provider, model });
  const streamWith = (u: typeof usage | undefined, s?: { provider: string; model: string }) =>
    askFarahChatStream.mockImplementation(async function* (_t: unknown, _e: unknown, _m: unknown, opts?: { onUsage?: (u: typeof usage, served?: { provider: string; model: string }) => void }) {
      yield "ok";
      if (u) opts?.onUsage?.(u, s);
    });

  it("a completed Groq reply is added at its priced amount: 2,400 in + 470 out = 642,000 nano-dollars", async () => {
    streamWith(usage, served("groq", "openai/gpt-oss-120b"));
    await (await POST(request())).text();
    expect(addSpendNano).toHaveBeenCalledTimes(1);
    expect(addSpendNano).toHaveBeenCalledWith(642_000);
  });

  it("a reply served by the FAILOVER model is priced at the Gemini row: 2,400 in + 470 out = 7,125,000 nano-dollars", async () => {
    streamWith(usage, served("gemini", "gemini-3.6-flash"));
    await (await POST(request())).text();
    expect(addSpendNano).toHaveBeenCalledWith(7_125_000);
  });

  it("a reply from an UNKNOWN model with counts is priced at the most expensive known row (never at the Groq row, never at zero)", async () => {
    streamWith(usage, served("someone-else", "x-1"));
    await (await POST(request())).text();
    expect(addSpendNano).toHaveBeenCalledWith(7_125_000);
  });

  it("a completed reply that reported no token counts is added at the worst-case flat estimate (never zero, never the typical figure)", async () => {
    const m = await spend();
    streamWith(undefined);
    await (await POST(request())).text();
    expect(addSpendNano).toHaveBeenCalledTimes(1);
    expect(addSpendNano).toHaveBeenCalledWith(m.NO_COUNTS_REPLY_ESTIMATE_NANO);
    expect(m.NO_COUNTS_REPLY_ESTIMATE_NANO).toBeGreaterThan(m.FAILED_ATTEMPT_ESTIMATE_NANO);
  });

  it("an attempt whose model call fails is added at the failed-attempt estimate, and the user is not charged", async () => {
    const m = await spend();
    askFarahChatStream.mockImplementation(async function* () {
      throw new LLMProviderError("groq", "unknown", "boom");
    });
    await (await POST(request())).text();
    expect(addSpendNano).toHaveBeenCalledTimes(1);
    expect(addSpendNano).toHaveBeenCalledWith(m.FAILED_ATTEMPT_ESTIMATE_NANO);
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
  });

  it("an attempt the reader walks away from mid-reply is added ONCE at the failed-attempt estimate, and nothing is charged or saved", async () => {
    const m = await spend();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    askFarahChatStream.mockImplementation(async function* () {
      yield "first part";
      await gate;
      yield "second part";
    });
    const res = await POST(request());
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    release();
    await wait();
    expect(addSpendNano).toHaveBeenCalledTimes(1);
    expect(addSpendNano).toHaveBeenCalledWith(m.FAILED_ATTEMPT_ESTIMATE_NANO);
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it("nothing is added when no model call happened (a refusal at the gate)", async () => {
    const { InsufficientCreditsError } = await import("@/lib/farah/chat-gate");
    checkFarahChatAllowance.mockRejectedValue(new InsufficientCreditsError(1, 0));
    await (await POST(request())).text();
    expect(askFarahChatStream).not.toHaveBeenCalled();
    expect(addSpendNano).not.toHaveBeenCalled();
  });

  it("a failure to record the spend never turns a delivered reply into an error, and writes ONE content-free [farah-spend:counter-failed] line", async () => {
    addSpendNano.mockRejectedValue(new Error(INTERNAL_ERROR_TEXT));
    const res = await POST(request());
    const events = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(false);
    const lines = spendLines(errorSpy);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[farah-spend:counter-failed\]/);
    expect(lines[0]).not.toContain("internal-db-7");
    expect(lines[0]).not.toContain(MESSAGE);
    expect(lines[0]).not.toContain("route-test-user");
  });
});

describe("the 50% warning is one content-free line per day", () => {
  it("fires for the first request that sees 50%, with no message text and no user id", async () => {
    readSpendNano.mockResolvedValue((await ceilingNano()) / 2);
    markHalfwayWarned.mockResolvedValue(true);
    await (await POST(request())).text();
    const lines = spendLines(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[farah-spend:half\] .*50%/);
    expect(lines[0]).not.toContain(MESSAGE);
    expect(lines[0]).not.toContain("route-test-user");
  });

  it("is silent when someone already warned today, and below 50%", async () => {
    const ceiling = await ceilingNano();
    readSpendNano.mockResolvedValue(ceiling * 0.7);
    markHalfwayWarned.mockResolvedValue(false);
    await (await POST(request())).text();
    readSpendNano.mockResolvedValue(ceiling / 2 - 1);
    markHalfwayWarned.mockResolvedValue(true);
    await (await POST(request())).text();
    expect(spendLines(warn)).toHaveLength(0);
  });
});
