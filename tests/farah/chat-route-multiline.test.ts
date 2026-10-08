/**
 * A multi-line message at the route: its line breaks reach the model and the saved row intact, it goes through the gate and is charged exactly as a one-line message is, the length limit counts a line break as one
 * character and still blocks at the limit, and an empty or newline-only message is refused before anything happens. The model, the gate and Supabase are mocked at the module boundary, like the other route tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { countForLimit } from "@/lib/text-limits";
import { MAX_MESSAGE_LENGTH } from "@/lib/farah/token-budget";

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
vi.mock("@/lib/farah/session-events", () => ({ logFarahSessionMessage: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/farah/spend-tally", async () => (await import("./support/route-mocks")).safeSpendTally());
vi.mock("@/lib/farah/chat-gate", async () => (await import("./support/route-mocks")).safeChatGate({ checkFarahChatAllowance, commitFarahChatAllowance }));
const { POST } = await import("@/app/api/farah/chat/route");

const PAID = { isFreeAllowance: false, isPassCovered: false, creditsSpent: 1, creditsAvailableAtCheck: 5, freeMessagesRemaining: 0 };
const post = (message: string) => POST(new Request("http://localhost/api/farah/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) }));
let turnsSeen: Array<{ role: string; content: string }> | undefined;

beforeEach(() => {
  inserted.length = 0;
  turnsSeen = undefined;
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "route-test-user" } } });
  checkFarahChatAllowance.mockReset().mockResolvedValue(PAID);
  commitFarahChatAllowance.mockReset().mockResolvedValue({ balanceAfter: 4 });
  askFarahChatStream.mockReset().mockImplementation(async function* (turns: Array<{ role: string; content: string }>) {
    turnsSeen = turns;
    yield "A reply.";
  });
});

describe("a multi-line message", () => {
  const MULTI = "First line\nSecond line\n\nFourth line after a blank one";

  it("reaches the model with its line breaks intact, and is saved with them", async () => {
    await (await post(MULTI)).text();
    expect(turnsSeen?.at(-1)).toEqual({ role: "user", content: MULTI });
    expect(inserted.find((r) => r.role === "user")?.content).toBe(MULTI);
  });

  it("is charged exactly as a one-line message is: the same gate check, the same one commit, the same arguments", async () => {
    await (await post("One line only")).text();
    const oneLine = { check: checkFarahChatAllowance.mock.calls.map((c) => c.length), commit: commitFarahChatAllowance.mock.calls.map((c) => c[1]), n: commitFarahChatAllowance.mock.calls.length };
    checkFarahChatAllowance.mockClear();
    commitFarahChatAllowance.mockClear();
    await (await post(MULTI)).text();
    expect(checkFarahChatAllowance).toHaveBeenCalledTimes(1);
    expect(commitFarahChatAllowance).toHaveBeenCalledTimes(1);
    expect({ check: checkFarahChatAllowance.mock.calls.map((c) => c.length), commit: commitFarahChatAllowance.mock.calls.map((c) => c[1]), n: 1 }).toEqual(oneLine);
  });

  it("the model is called once per message, however many lines it has", async () => {
    await (await post(MULTI)).text();
    expect(askFarahChatStream).toHaveBeenCalledTimes(1);
  });
});

describe("the length limit counts a line break as one character, and still blocks at the limit", () => {
  const lines = (n: number) => "a\n".repeat(n / 2); // n characters in all: every line break is one

  it("exactly the limit, made of lines, is accepted", async () => {
    const m = lines(MAX_MESSAGE_LENGTH - 2) + "bb"; // ends on a letter so trimming changes nothing
    expect(m.length).toBe(MAX_MESSAGE_LENGTH);
    const res = await post(m);
    expect(res.status).toBe(200);
    await res.text();
    expect(askFarahChatStream).toHaveBeenCalledTimes(1);
  });

  it("one character over the limit is refused before the gate or the model: 400, nothing charged, nothing saved", async () => {
    const m = lines(MAX_MESSAGE_LENGTH) + "b";
    expect(m.length).toBe(MAX_MESSAGE_LENGTH + 1);
    const res = await post(m);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain(String(MAX_MESSAGE_LENGTH));
    expect(askFarahChatStream).not.toHaveBeenCalled();
    expect(checkFarahChatAllowance).not.toHaveBeenCalled();
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
  });

  it("the box's count and the server's count are the same rule (trimmed length, a line break is one)", () => {
    for (const t of ["abc", "a\nb", "  a\n\nb  \n", "\n\nx\n", "é\nü"]) expect(countForLimit(t), JSON.stringify(t)).toBe(t.trim().length);
  });
});

describe("nothing to send", () => {
  for (const [name, m] of [["empty", ""], ["spaces", "   "], ["only newlines", "\n\n\n"], ["newlines and spaces", " \n \t\n "]] as const) {
    it(`${name}: refused with 400 before anything happens`, async () => {
      const res = await post(m);
      expect(res.status).toBe(400);
      expect(askFarahChatStream).not.toHaveBeenCalled();
      expect(checkFarahChatAllowance).not.toHaveBeenCalled();
      expect(commitFarahChatAllowance).not.toHaveBeenCalled();
      expect(inserted).toEqual([]);
    });
  }
});
