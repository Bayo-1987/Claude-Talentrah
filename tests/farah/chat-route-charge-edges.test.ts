/**
 * CHARACTERIZATION (report only; this work does not change behaviour): the Farah chat route commits the charge when the whole reply has
 * completed, not before. These tests pin that on today's code for failed calls and for a response that ends before completion, so any future
 * change to charge timing has to change them on purpose. "Ends early" is simulated by cancelling the response body's reader; it is not a real
 * network abort. Same mocking shape as chat-route-length-stop.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LLMProviderError } from "@/lib/llm";

const getUser = vi.fn();
const checkFarahChatAllowance = vi.fn();
const commitFarahChatAllowance = vi.fn();
const askFarahChatStream = vi.fn();
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
const { POST } = await import("@/app/api/farah/chat/route");

const FREE = { isFreeAllowance: true, isPassCovered: false, creditsSpent: 0, creditsAvailableAtCheck: 41, freeMessagesRemaining: 2 };
const PAID = { isFreeAllowance: false, isPassCovered: false, creditsSpent: 1, creditsAvailableAtCheck: 41, freeMessagesRemaining: 0 };
const PASS = { isFreeAllowance: false, isPassCovered: true, creditsSpent: 0, creditsAvailableAtCheck: 41, freeMessagesRemaining: null };
const BRANCHES: Array<[string, { isFreeAllowance: boolean; isPassCovered: boolean; creditsSpent: number; creditsAvailableAtCheck: number; freeMessagesRemaining: number | null }]> = [
  ["free message", FREE],
  ["credit", PAID],
  ["Pass", PASS],
];

const request = () =>
  new Request("http://localhost/api/farah/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Help me prep." }) });
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

beforeEach(() => {
  inserted.length = 0;
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "route-test-user" } } });
  checkFarahChatAllowance.mockReset();
  commitFarahChatAllowance.mockReset().mockResolvedValue({ balanceAfter: null });
  askFarahChatStream.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a failed call commits nothing and saves nothing, on every allowance branch", () => {
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
        yield " and the second";
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
  for (const [branchName, allowance] of BRANCHES) {
    for (const [failureName, model] of failures) {
      it(`${branchName}: ${failureName}: no commit, nothing saved, an error event and no done event`, async () => {
        checkFarahChatAllowance.mockResolvedValue(allowance);
        askFarahChatStream.mockImplementation(model);
        const events = eventsOf(await (await POST(request())).text());
        expect(commitFarahChatAllowance).not.toHaveBeenCalled();
        expect(inserted).toEqual([]);
        expect(events.some((e) => e.type === "error")).toBe(true);
        expect(events.some((e) => e.type === "done")).toBe(false);
      });
    }
  }

  it("control: a reply that completes IS committed exactly once and saved (so the tests above are not passing because nothing ever commits)", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    askFarahChatStream.mockImplementation(async function* () {
      yield "A full reply.";
    });
    const events = eventsOf(await (await POST(request())).text());
    expect(commitFarahChatAllowance).toHaveBeenCalledTimes(1);
    expect(inserted.length).toBe(2);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});

describe("the charge commits when the reply completes: a response that ends early (the body is cancelled)", () => {
  it("ends before the first token: nothing is committed and nothing is saved", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
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
    expect(inserted).toEqual([]);
  });

  it("ends part-way through: nothing is committed and nothing is saved (both belong to completion)", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    const gate = deferred();
    askFarahChatStream.mockImplementation(async function* () {
      yield "Almost the whole answer, ";
      yield "all of it really, ";
      await gate.promise;
      yield "and the last few words.";
    });
    const res = await POST(request());
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("Almost the whole answer");
    await reader.cancel();
    gate.resolve();
    await wait();
    expect(commitFarahChatAllowance, "the commit belongs to completion").not.toHaveBeenCalled();
    expect(inserted, "saved rows belong to completion too").toEqual([]);
  });

  it("ends after the last token (the model has said everything, the call has not yet finished): the commit and the saved rows still happen", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    const gate = deferred();
    askFarahChatStream.mockImplementation(async function* () {
      yield "The complete answer.";
      await gate.promise;
    });
    const res = await POST(request());
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("The complete answer.");
    await reader.cancel();
    gate.resolve();
    await wait();
    expect(commitFarahChatAllowance, "completion commits").toHaveBeenCalledTimes(1);
    expect(inserted.length).toBe(2);
  });
});
