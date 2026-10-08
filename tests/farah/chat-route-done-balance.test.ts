/**
 * send-485 (issue #605) — the route's `done` event carries `creditsBalance`. See
 * tests/farah/chat-done-balance.test.ts for the gate half. Same mocking shape as
 * tests/farah/chat-route-job-seed.test.ts: the LLM, the gate and Supabase are mocked at the module
 * boundary, so this is a fast test of chat/route.ts's own control flow.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const checkFarahChatAllowance = vi.fn();
const commitFarahChatAllowance = vi.fn();
const askFarahChatStream = vi.fn();
const logFarahSessionMessage = vi.fn();
let persistFails = false;

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
        // Reads (the hourly count, the history) always succeed; only the INSERTs fail when asked to —
        // a failed read would return a 500 before the stream ever starts, which is a different test.
        const reads = chainable({ count: 0, data: [], error: null });
        const insertOk = chainable({ data: { id: "m1", created_at: "2026-01-01T00:00:00.000Z" }, error: null });
        const insertBad = chainable({ data: null, error: { message: "insert failed" } });
        return new Proxy(reads as object, {
          get(target, prop, receiver) {
            if (prop === "insert") return () => (persistFails ? insertBad : insertOk);
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
vi.mock("@/lib/farah/session-events", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/farah/session-events")>()), logFarahSessionMessage }));
vi.mock("@/lib/farah/spend-tally", async () => (await import("./support/route-mocks")).safeSpendTally());
vi.mock("@/lib/farah/chat-gate", async () => (await import("./support/route-mocks")).safeChatGate({ checkFarahChatAllowance, commitFarahChatAllowance }));

const { POST } = await import("@/app/api/farah/chat/route");

const PAID = { isFreeAllowance: false, isPassCovered: false, creditsSpent: 1, creditsAvailableAtCheck: 41, freeMessagesRemaining: 0 };
const FREE = { isFreeAllowance: true, isPassCovered: false, creditsSpent: 0, creditsAvailableAtCheck: 41, freeMessagesRemaining: 2 };

async function send(): Promise<Array<Record<string, unknown>>> {
  const res = await POST(
    new Request("http://localhost/api/farah/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello" }),
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
  persistFails = false;
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "route-test-user" } } });
  checkFarahChatAllowance.mockReset();
  commitFarahChatAllowance.mockReset();
  askFarahChatStream.mockReset().mockImplementation(async function* () {
    yield "A reply.";
  });
  logFarahSessionMessage.mockReset().mockResolvedValue(undefined);
});

describe("done.creditsBalance", () => {
  it("a paid message reports the balance the commit returned", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    commitFarahChatAllowance.mockResolvedValue({ balanceAfter: 40 });
    const done = doneOf(await send());
    expect(done, "no done event").toBeTruthy();
    expect(done!.creditsBalance).toBe(40);
  });

  it("uses the commit's number as given, not check-time balance minus cost", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    commitFarahChatAllowance.mockResolvedValue({ balanceAfter: 35 });
    expect(doneOf(await send())!.creditsBalance).toBe(35);
  });

  it("a free message leaves the balance out of it: creditsBalance is null, never a number", async () => {
    checkFarahChatAllowance.mockResolvedValue(FREE);
    commitFarahChatAllowance.mockResolvedValue({ balanceAfter: null });
    const done = doneOf(await send());
    expect(done).toBeTruthy();
    expect(done!.creditsBalance).toBeNull();
    // ...and the free-allowance counter it already carried is unchanged.
    expect(done!.freeMessagesRemaining).toBe(2);
  });

  it("a paid message whose transcript failed to save still reports the new balance (the credit WAS spent)", async () => {
    persistFails = true;
    checkFarahChatAllowance.mockResolvedValue(PAID);
    commitFarahChatAllowance.mockResolvedValue({ balanceAfter: 40 });
    const done = doneOf(await send());
    expect(done!.persisted).toBe(false);
    expect(done!.creditsBalance).toBe(40);
  });

  it("tolerates a commit that returns nothing (treated as no balance change)", async () => {
    checkFarahChatAllowance.mockResolvedValue(FREE);
    commitFarahChatAllowance.mockResolvedValue(undefined);
    expect(doneOf(await send())!.creditsBalance).toBeNull();
  });

  it("an errored reply sends no done event at all, so no balance can be claimed for a message that cost nothing", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    askFarahChatStream.mockImplementation(async function* () {
      throw new Error("provider down");
    });
    const events = await send();
    expect(doneOf(events)).toBeUndefined();
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
  });
});
