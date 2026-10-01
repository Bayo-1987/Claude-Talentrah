/**
 * send-500 (PR C) — a reply that stopped because it hit the output ceiling is never charged as a complete answer.
 *
 * WHAT WENT WRONG (measured). The owner's reply ended mid-sentence ("I'm a FinTech Product Manager with") and
 * cost 1 credit. Production has 5 of 34 replies in 30 days that end without terminal punctuation, six that
 * sit at or past the 1,024-token ceiling (the one in question was 4,088 characters, which is 1,022 tokens at
 * the 4-characters-per-token estimate `token-budget.ts` uses). `generateTextStream` yields only text, so the
 * provider's `finish_reason` was never read: a length stop and a clean stop were the same thing to the route,
 * which charged for both.
 *
 * THE CHOICE, and why: a length stop is NOT CHARGED (and does not use up a free message). The alternative,
 * continuing the reply with a second call, was rejected because Farah's failure mode in production is the
 * provider's per-minute token cap (send-109, `token-budget.ts`), and a continuation replays the whole prompt and
 * history again for the same user action. Not charging is deterministic, costs nothing extra, and is honest:
 * the user did not get a complete answer. The cut-off text is still shown and saved (marked truncated), so
 * nothing the user already read vanishes, and the reply tells them it was cut off and was not charged.
 *
 * Same mocking shape as chat-route-done-balance.test.ts: the LLM, the gate and Supabase are mocked at the module
 * boundary, so this is a fast test of chat/route.ts's own control flow.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const checkFarahChatAllowance = vi.fn();
const commitFarahChatAllowance = vi.fn();
const askFarahChatStream = vi.fn();
const logFarahSessionMessage = vi.fn();
const inserted: Array<Record<string, unknown>> = [];

function chainable(chainResult: Record<string, unknown>, singleResult?: Record<string, unknown>): unknown {
  const proxy: object = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve(chainResult);
        if (prop === "maybeSingle" || prop === "single") return async () => singleResult ?? chainResult;
        return () => proxy;
      },
    },
  );
  return proxy;
}

function fakeSupabase() {
  return {
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
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase() }));
vi.mock("@/lib/farah/client", () => ({ askFarahChatStream }));
vi.mock("@/lib/farah/session-events", () => ({ logFarahSessionMessage }));
vi.mock("@/lib/farah/chat-gate", () => ({
  checkFarahChatAllowance,
  commitFarahChatAllowance,
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));

const { POST } = await import("@/app/api/farah/chat/route");

const PAID = { isFreeAllowance: false, isPassCovered: false, creditsSpent: 1, creditsAvailableAtCheck: 41, freeMessagesRemaining: 0 };
const FREE = { isFreeAllowance: true, isPassCovered: false, creditsSpent: 0, creditsAvailableAtCheck: 41, freeMessagesRemaining: 2 };

type FinishReason = "stop" | "length" | "other";
type Opts = { quickAction?: string; onFinish?: (r: FinishReason) => void };

/** A model that says some text and then reports why it stopped — what the real providers now do. */
function modelThatFinishes(reason: FinishReason) {
  askFarahChatStream.mockImplementation(async function* (_turns: unknown, _extra: unknown, _max: unknown, opts?: Opts) {
    yield "I'm a FinTech Product Manager with";
    opts?.onFinish?.(reason);
  });
}

async function send(quickAction?: string): Promise<Array<Record<string, unknown>>> {
  const res = await POST(
    new Request("http://localhost/api/farah/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "I'd like some career advice.", quickAction }),
    }),
  );
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}
const doneOf = (events: Array<Record<string, unknown>>) => events.find((e) => e.type === "done");

beforeEach(() => {
  inserted.length = 0;
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "route-test-user" } } });
  checkFarahChatAllowance.mockReset();
  commitFarahChatAllowance.mockReset();
  askFarahChatStream.mockReset();
  logFarahSessionMessage.mockReset().mockResolvedValue(undefined);
});

describe("a reply cut off by the output ceiling", () => {
  it("is NOT charged: the allowance commit is never called", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    commitFarahChatAllowance.mockResolvedValue({ balanceAfter: 40 });
    modelThatFinishes("length");
    await send("career-advisor");
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
  });

  it("is reported as truncated, with no balance change and an unchanged free-message count", async () => {
    checkFarahChatAllowance.mockResolvedValue(FREE);
    modelThatFinishes("length");
    const done = doneOf(await send());
    expect(done, "no done event").toBeTruthy();
    expect(done!.truncated).toBe(true);
    expect(done!.creditsBalance).toBeNull();
    // A free message that was not used up: the count the gate reported BEFORE this one (3), not after it (2).
    expect(done!.freeMessagesRemaining).toBe(3);
  });

  it("is still saved, marked truncated, so what the user already read is not lost", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    modelThatFinishes("length");
    await send("career-advisor");
    const farahRow = inserted.find((r) => r.role === "farah");
    expect(farahRow, "the cut-off reply should still be persisted").toBeTruthy();
    expect((farahRow!.context as Record<string, unknown>).truncated).toBe(true);
    expect((farahRow!.context as Record<string, unknown>).quickAction).toBe("career-advisor");
  });
});

describe("controls: a reply that finished is charged exactly as before", () => {
  it("a clean stop commits the allowance and reports the new balance", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    commitFarahChatAllowance.mockResolvedValue({ balanceAfter: 40 });
    modelThatFinishes("stop");
    const done = doneOf(await send());
    expect(commitFarahChatAllowance).toHaveBeenCalledTimes(1);
    expect(done!.creditsBalance).toBe(40);
    expect(done!.truncated).toBeFalsy();
  });

  it("a provider that never reports a reason (older stub, a path with no signal) is treated as finished, not truncated", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    commitFarahChatAllowance.mockResolvedValue({ balanceAfter: 40 });
    askFarahChatStream.mockImplementation(async function* () {
      yield "A complete reply.";
    });
    const done = doneOf(await send());
    expect(commitFarahChatAllowance).toHaveBeenCalledTimes(1);
    expect(done!.truncated).toBeFalsy();
  });

  it("an unrecognised stop reason ('other') is not treated as a cut-off", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    commitFarahChatAllowance.mockResolvedValue({ balanceAfter: 40 });
    modelThatFinishes("other");
    await send();
    expect(commitFarahChatAllowance).toHaveBeenCalledTimes(1);
  });
});

describe("the route hands the quick action to the model call", () => {
  it("passes the quick action key through, so the prompt can be built per action", async () => {
    checkFarahChatAllowance.mockResolvedValue(FREE);
    commitFarahChatAllowance.mockResolvedValue({ balanceAfter: null });
    let seen: Opts | undefined;
    askFarahChatStream.mockImplementation(async function* (_t: unknown, _e: unknown, _m: unknown, opts?: Opts) {
      seen = opts;
      yield "ok.";
    });
    await send("salary-negotiation");
    expect(seen?.quickAction).toBe("salary-negotiation");
    expect(typeof seen?.onFinish).toBe("function");
  });
});
