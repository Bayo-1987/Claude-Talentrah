/**
 * Chat route: the request's abort signal reaches the model call (no deployment needed to prove it: the model, the gate and Supabase are mocked at the module boundary, like chat-route-length-stop.test.ts).
 *
 * When the reader goes away the model call should stop. Until now the route passed nothing to the provider, so a closed tab was noticed only when the next chunk was written, and nothing at all was noticed
 * while the model was still in its reasoning phase (no text is yielded then). The route passes `request.signal` down; these tests pin that it arrives, and what the route does when it fires.
 *
 *   1. the signal given to the model call follows the request's signal;
 *   2. a mid-reply abort ends the reply: the provider is closed, nothing is saved, no one is charged;
 *   3. an abort before the first chunk (the reasoning phase) ends the call the same way, without hanging;
 *   4. a request that is already aborted makes no model call and charges no one.
 * A model that ignores the signal makes tests 2 and 3 time out, which is the failure they report.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const checkFarahChatAllowance = vi.fn();
const commitFarahChatAllowance = vi.fn();
const askFarahChatStream = vi.fn();
const inserted: Array<Record<string, unknown>> = [];

function chainable(chainResult: Record<string, unknown>, singleResult?: Record<string, unknown>): unknown {
  const proxy: object = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(chainResult);
      if (prop === "maybeSingle" || prop === "single") return async () => singleResult ?? chainResult;
      return () => proxy;
    },
  });
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
            if (prop === "insert") return (row: Record<string, unknown>) => { inserted.push(row); return insertOk; };
            return Reflect.get(target, prop, receiver);
          },
        });
      }
      return chainable({ data: null, error: null });
    },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => fakeSupabase() }));
vi.mock("@/lib/farah/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/farah/client")>()), askFarahChatStream }));
vi.mock("@/lib/farah/spend-tally", async () => (await import("./support/route-mocks")).safeSpendTally());
vi.mock("@/lib/farah/session-events", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/farah/session-events")>()), logFarahSessionMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/farah/chat-gate", async () => (await import("./support/route-mocks")).safeChatGate({ checkFarahChatAllowance, commitFarahChatAllowance }));
const { POST } = await import("@/app/api/farah/chat/route");

const FREE = { isFreeAllowance: true, isPassCovered: false, creditsSpent: 0, creditsAvailableAtCheck: 41, freeMessagesRemaining: 2 };
const request = (signal?: AbortSignal) =>
  new Request("http://localhost/api/farah/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "A question about my career." }), signal });

type Opts = { signal?: AbortSignal };
let seen: { opts?: Opts; closed: boolean };

/** A model that honours the signal the way the real provider does: it stops when the signal fires. If the route never hands the signal over, it waits forever (and the test times out). */
function modelThatHonoursTheSignal(yieldFirst: string | null) {
  askFarahChatStream.mockImplementation(async function* (_t: unknown, _e: unknown, _m: unknown, opts?: Opts) {
    seen.opts = opts;
    try {
      if (yieldFirst) yield yieldFirst;
      await new Promise<void>((_resolve, reject) => {
        if (opts?.signal?.aborted) reject(new Error("aborted"));
        opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
      yield "never reached";
    } finally {
      seen.closed = true;
    }
  });
}

beforeEach(() => {
  inserted.length = 0;
  seen = { closed: false };
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "route-test-user" } } });
  checkFarahChatAllowance.mockReset().mockResolvedValue(FREE);
  commitFarahChatAllowance.mockReset().mockResolvedValue({ balanceAfter: null });
  askFarahChatStream.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the request's abort signal reaches the model call", () => {
  it("1. the signal handed to the model call follows the request's signal", async () => {
    askFarahChatStream.mockImplementation(async function* (_t: unknown, _e: unknown, _m: unknown, opts?: Opts) {
      seen.opts = opts;
      yield "A reply.";
    });
    const controller = new AbortController();
    const res = await POST(request(controller.signal));
    await res.text();
    const handed = seen.opts?.signal;
    expect(handed, "the model call received no signal").toBeInstanceOf(AbortSignal);
    expect(handed!.aborted).toBe(false);
    controller.abort();
    expect(handed!.aborted, "aborting the request did not abort the signal the model call holds").toBe(true);
  });

  it("2. a mid-reply abort ends the reply: the model call is closed, nothing is saved, no one is charged", async () => {
    modelThatHonoursTheSignal("first part of a reply");
    const controller = new AbortController();
    const res = await POST(request(controller.signal));
    const reader = res.body!.getReader();
    await reader.read(); // the first part arrives
    controller.abort();
    // the rest of the stream must end, not hang
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    expect(seen.closed, "the model call was not closed").toBe(true);
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  }, 3000);

  it("3. an abort before the first chunk (the reasoning phase) ends the call the same way, without hanging", async () => {
    modelThatHonoursTheSignal(null);
    const controller = new AbortController();
    const res = await POST(request(controller.signal));
    controller.abort();
    await res.text();
    expect(seen.closed, "the model call was not closed").toBe(true);
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  }, 3000);

  it("4. a request that is already aborted makes no model call and charges no one", async () => {
    modelThatHonoursTheSignal("a reply");
    const controller = new AbortController();
    controller.abort();
    const res = await POST(request(controller.signal));
    await res.text();
    expect(askFarahChatStream).not.toHaveBeenCalled();
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  }, 3000);
});
