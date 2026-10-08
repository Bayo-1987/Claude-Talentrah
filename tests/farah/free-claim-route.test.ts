/**
 * The free-message claim at the route (migration 0236): a request that holds a claim must settle it on EVERY way out. A reply that completes commits it (once); every other way out releases it,
 * so a message that never happened never uses a free slot: a model failure at any point, an empty reply, a reply cut off at the length cap, a reader that goes away, a request aborted before the
 * model call, and the early refusals after the check. A claim that is never settled (a crash) expires by itself in the database; these tests are about the exits the route controls.
 *
 * The gate is faked at the module edge (its own behaviour is in tests/farah/free-claim-gate.test.ts). Same mocking shape as tests/farah/chat-route-charge-edges.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LLMProviderError } from "@/lib/llm";

const getUser = vi.fn();
const checkFarahChatAllowance = vi.fn();
const commitFarahChatAllowance = vi.fn();
const releaseFarahChatAllowance = vi.fn();
const askFarahChatStream = vi.fn();
const inserted: Array<Record<string, unknown>> = [];
let historyError: unknown = null;

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
            if (prop === "select")
              // the history read (a select with an order and a limit) is the one the test can make fail; the hourly count is a head select and always works
              return (_cols?: string, opts?: { head?: boolean }) => (opts?.head ? reads : chainable({ data: historyError ? null : [], error: historyError }));
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
vi.mock("@/lib/farah/session-events", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/farah/session-events")>()), logFarahSessionMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/farah/spend-tally", async () => (await import("./support/route-mocks")).safeSpendTally());
vi.mock("@/lib/farah/chat-gate", async () => (await import("./support/route-mocks")).safeChatGate({ checkFarahChatAllowance, commitFarahChatAllowance, releaseFarahChatAllowance, farahChatNextFreeMessageAt: vi.fn().mockResolvedValue(null) }));
const { POST } = await import("@/app/api/farah/chat/route");

const CLAIMED = { isFreeAllowance: true, isPassCovered: false, creditsSpent: 0, creditsAvailableAtCheck: 41, freeMessagesRemaining: 1, freeClaimId: "claim-1" };
const PAID = { isFreeAllowance: false, isPassCovered: false, creditsSpent: 1, creditsAvailableAtCheck: 41, freeMessagesRemaining: 0 };
const LEGACY_FREE = { isFreeAllowance: true, isPassCovered: false, creditsSpent: 0, creditsAvailableAtCheck: 41, freeMessagesRemaining: 1 };

const request = (signal?: AbortSignal) =>
  new Request("http://localhost/api/farah/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Help me prep." }), signal });
const eventsOf = (text: string) =>
  text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
const released = () => releaseFarahChatAllowance.mock.calls;

beforeEach(() => {
  inserted.length = 0;
  historyError = null;
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "route-test-user" } } });
  checkFarahChatAllowance.mockReset().mockResolvedValue(CLAIMED);
  commitFarahChatAllowance.mockReset().mockResolvedValue({ balanceAfter: null });
  releaseFarahChatAllowance.mockReset().mockResolvedValue(undefined);
  askFarahChatStream.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("a reply that completes commits the claim once and does not release it", () => {
  it("commits exactly once with the held allowance, saves the exchange, and never releases", async () => {
    askFarahChatStream.mockImplementation(async function* () {
      yield "A full reply.";
    });
    const events = eventsOf(await (await POST(request())).text());
    expect(commitFarahChatAllowance).toHaveBeenCalledTimes(1);
    expect(commitFarahChatAllowance).toHaveBeenCalledWith("route-test-user", CLAIMED);
    expect(releaseFarahChatAllowance).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(inserted.length).toBe(2);
  });

  it("a commit that THROWS (a paid message the balance no longer covers) is not followed by a release: nothing to give back, and the claim is the commit's to settle", async () => {
    checkFarahChatAllowance.mockResolvedValue(CLAIMED);
    commitFarahChatAllowance.mockRejectedValue(new Error("commit failed"));
    askFarahChatStream.mockImplementation(async function* () {
      yield "A full reply.";
    });
    await (await POST(request())).text().catch(() => "");
    expect(commitFarahChatAllowance).toHaveBeenCalledTimes(1);
  });
});

describe("every other way out releases the claim, exactly once", () => {
  const failures: Array<[string, () => AsyncGenerator<string>]> = [
    [
      "a rate limit before the first token",
      async function* () {
        throw new LLMProviderError("groq", "rate_limit", "Please try again in 1m2s.");
      },
    ],
    [
      "a generic error",
      async function* () {
        throw new Error("boom");
      },
    ],
    [
      "an error part-way through the stream",
      async function* () {
        yield "Here is the first part";
        throw new LLMProviderError("groq", "unknown", "connection reset");
      },
    ],
    [
      "an empty stream (no chunks, no error)",
      async function* () {
        /* yields nothing */
      },
    ],
  ];
  for (const [name, model] of failures) {
    it(`${name}: released once, never committed, an error event and no done event`, async () => {
      askFarahChatStream.mockImplementation(model);
      const events = eventsOf(await (await POST(request())).text());
      expect(commitFarahChatAllowance).not.toHaveBeenCalled();
      expect(released()).toEqual([["route-test-user", CLAIMED]]);
      expect(events.some((e) => e.type === "error")).toBe(true);
      expect(events.some((e) => e.type === "done")).toBe(false);
    });
  }

  it("a reply cut off at the length cap uses no free message: released, not committed, and still shown and saved", async () => {
    askFarahChatStream.mockImplementation(async function* (_turns: unknown, _ctx: unknown, _x: unknown, opts?: { onFinish?: (r: string) => void }) {
      yield "A reply that was cut o";
      opts?.onFinish?.("length");
    });
    const events = eventsOf(await (await POST(request())).text());
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
    expect(released()).toEqual([["route-test-user", CLAIMED]]);
    expect(events.find((e) => e.type === "done")).toMatchObject({ truncated: true });
  });

  it("a reader that goes away before the first token: released, not committed", async () => {
    const gate = deferred();
    askFarahChatStream.mockImplementation(async function* () {
      await gate.promise;
      yield "late first chunk";
    });
    const res = await POST(request());
    await res.body!.getReader().cancel();
    gate.resolve();
    await wait();
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
    expect(released()).toEqual([["route-test-user", CLAIMED]]);
  });

  it("a reader that goes away part-way through: released, not committed", async () => {
    const gate = deferred();
    askFarahChatStream.mockImplementation(async function* () {
      yield "Almost the whole answer, ";
      await gate.promise;
      yield "and the last few words.";
    });
    const res = await POST(request());
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    gate.resolve();
    await wait();
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
    expect(released()).toEqual([["route-test-user", CLAIMED]]);
  });

  it("a request already aborted when the model call would start (499): released, no model call", async () => {
    const controller = new AbortController();
    controller.abort();
    const res = await POST(request(controller.signal));
    expect(res.status).toBe(499);
    expect(askFarahChatStream).not.toHaveBeenCalled();
    expect(released()).toEqual([["route-test-user", CLAIMED]]);
  });

  it("the history read failing after the check (500): released, no model call", async () => {
    historyError = { message: "boom" };
    const res = await POST(request());
    expect(res.status).toBe(500);
    expect(askFarahChatStream).not.toHaveBeenCalled();
    expect(released()).toEqual([["route-test-user", CLAIMED]]);
  });
});

describe("an allowance with no claim never touches the release", () => {
  it("a paid message that fails, and a legacy free message (no claim id) that fails: nothing to release", async () => {
    for (const allowance of [PAID, LEGACY_FREE]) {
      releaseFarahChatAllowance.mockClear();
      checkFarahChatAllowance.mockResolvedValue(allowance);
      askFarahChatStream.mockImplementation(async function* () {
        throw new Error("boom");
      });
      await (await POST(request())).text();
      expect(releaseFarahChatAllowance).not.toHaveBeenCalled();
    }
  });
});

describe("a release that fails does not change what the person sees", () => {
  it("the error event still arrives, and nothing throws out of the stream", async () => {
    releaseFarahChatAllowance.mockRejectedValue(new Error("release failed"));
    askFarahChatStream.mockImplementation(async function* () {
      throw new Error("boom");
    });
    const events = eventsOf(await (await POST(request())).text());
    expect(events.some((e) => e.type === "error")).toBe(true);
  });
});
