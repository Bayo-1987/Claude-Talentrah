/**
 * `nextFreeMessageAt` on the two responses the panel reads: GET /api/farah/history (on mount) and the chat route's `done` event (after each message).
 *
 * The rules: it is an ADDITIVE, optional field; it is an ISO time only when the free messages are used up and no Pass is active, and `null` in every other case (free messages remain, a Pass is
 * active, a failed message, a failed read) WITHOUT the extra read when it cannot be anything but null; a failure to read it never blocks the response, never charges, and never changes another field.
 * A failed message ("nothing charged") never commits, so it uses no free message and cannot move the date (the date is derived from the committed free-message events only).
 *
 * Both routes are tested at the module boundary (the gate, Supabase, the model are faked), the same way as the other route tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const hasActivePass = vi.fn();
const farahChatFreeMessagesRemaining = vi.fn();
const farahChatNextFreeMessageAt = vi.fn();
const checkFarahChatAllowance = vi.fn();
const commitFarahChatAllowance = vi.fn();
const askFarahChatStream = vi.fn();
const logFarahSessionMessage = vi.fn();

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
        const reads = chainable({ count: 0, data: [{ id: "m2", role: "assistant", content: "b", created_at: "2026-01-02T00:00:00Z" }, { id: "m1", role: "user", content: "a", created_at: "2026-01-01T00:00:00Z" }], error: null });
        const insertOk = chainable({ data: { id: "m9", created_at: "2026-01-03T00:00:00.000Z" }, error: null });
        return new Proxy(reads as object, {
          get(target, prop, receiver) {
            if (prop === "insert") return () => insertOk;
            return Reflect.get(target, prop, receiver);
          },
        });
      }
      return chainable({ data: [], error: null });
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => fakeSupabase() }));
vi.mock("@/lib/passes/entitlement", () => ({ hasActivePass }));
vi.mock("@/lib/farah/client", () => ({ askFarahChatStream }));
vi.mock("@/lib/farah/session-events", () => ({ logFarahSessionMessage }));
vi.mock("@/lib/farah/spend-tally", async () => (await import("./support/route-mocks")).safeSpendTally());
vi.mock("@/lib/farah/chat-gate", async () => (await import("./support/route-mocks")).safeChatGate({ checkFarahChatAllowance, commitFarahChatAllowance, farahChatFreeMessagesRemaining, farahChatNextFreeMessageAt }));

const { GET } = await import("@/app/api/farah/history/route");
const { POST } = await import("@/app/api/farah/chat/route");

const WHEN = "2026-11-12T09:30:00.000Z";

beforeEach(() => {
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u-1" } } });
  hasActivePass.mockReset().mockResolvedValue(false);
  farahChatFreeMessagesRemaining.mockReset().mockResolvedValue(0);
  farahChatNextFreeMessageAt.mockReset().mockResolvedValue(WHEN);
  checkFarahChatAllowance.mockReset();
  commitFarahChatAllowance.mockReset().mockResolvedValue({ balanceAfter: null });
  askFarahChatStream.mockReset().mockImplementation(async function* () {
    yield "A reply.";
  });
  logFarahSessionMessage.mockReset().mockResolvedValue(undefined);
});

describe("GET /api/farah/history", () => {
  it("free messages used up, no Pass: the field is the time the next one returns, and the read happened once, for this user", async () => {
    const body = await (await GET()).json();
    expect(body.nextFreeMessageAt).toBe(WHEN);
    expect(farahChatNextFreeMessageAt).toHaveBeenCalledTimes(1);
    expect(farahChatNextFreeMessageAt).toHaveBeenCalledWith("u-1");
  });

  it("free messages remain: null, and no extra read", async () => {
    farahChatFreeMessagesRemaining.mockResolvedValue(2);
    const body = await (await GET()).json();
    expect(body.nextFreeMessageAt).toBeNull();
    expect(farahChatNextFreeMessageAt).not.toHaveBeenCalled();
  });

  it("an active Pass: the free count is null as before, nextFreeMessageAt is null, and neither read happens", async () => {
    hasActivePass.mockResolvedValue(true);
    const body = await (await GET()).json();
    expect(body.freeMessagesRemaining).toBeNull();
    expect(body.nextFreeMessageAt).toBeNull();
    expect(farahChatNextFreeMessageAt).not.toHaveBeenCalled();
    expect(farahChatFreeMessagesRemaining).not.toHaveBeenCalled();
  });

  it("a failed read (the function answers null): null, and the response is the normal 200", async () => {
    farahChatNextFreeMessageAt.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).nextFreeMessageAt).toBeNull();
  });

  it("a read that THROWS never blocks the response: 200, null, every other field intact", async () => {
    farahChatNextFreeMessageAt.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nextFreeMessageAt).toBeNull();
    expect(body.freeMessagesRemaining).toBe(0);
    expect(body.messages).toHaveLength(2);
  });

  it("the existing fields are unchanged and the new one is the only addition", async () => {
    const body = await (await GET()).json();
    expect(Object.keys(body).sort()).toEqual(["freeMessagesRemaining", "hasUnreadNotification", "messages", "nextFreeMessageAt"]);
    expect(body.freeMessagesRemaining).toBe(0);
    expect(body.hasUnreadNotification).toBe(false);
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(["m1", "m2"]); // oldest first, as before
  });
});

const PAID = { isFreeAllowance: false, isPassCovered: false, creditsSpent: 1, creditsAvailableAtCheck: 41, freeMessagesRemaining: 0 };
const LAST_FREE = { isFreeAllowance: true, isPassCovered: false, creditsSpent: 0, creditsAvailableAtCheck: 41, freeMessagesRemaining: 0 };
const FREE_LEFT = { isFreeAllowance: true, isPassCovered: false, creditsSpent: 0, creditsAvailableAtCheck: 41, freeMessagesRemaining: 2 };
const PASS = { isFreeAllowance: false, isPassCovered: true, creditsSpent: 0, creditsAvailableAtCheck: 41, freeMessagesRemaining: null };

async function send(): Promise<Array<Record<string, unknown>>> {
  const res = await POST(
    new Request("http://localhost/api/farah/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "Hello" }) }),
  );
  return (await res.text()).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}
const doneOf = (events: Array<Record<string, unknown>>) => events.find((e) => e.type === "done");

describe("the chat `done` event", () => {
  it("a paid message (free messages used up, no Pass): carries the time, read after the commit", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    const done = doneOf(await send());
    expect(done!.nextFreeMessageAt).toBe(WHEN);
    expect(commitFarahChatAllowance).toHaveBeenCalledTimes(1);
    expect(commitFarahChatAllowance.mock.invocationCallOrder[0]).toBeLessThan(farahChatNextFreeMessageAt.mock.invocationCallOrder[0]);
  });

  it("the LAST free message just used: free count 0, so it carries the time (it counts itself)", async () => {
    checkFarahChatAllowance.mockResolvedValue(LAST_FREE);
    const done = doneOf(await send());
    expect(done!.freeMessagesRemaining).toBe(0);
    expect(done!.nextFreeMessageAt).toBe(WHEN);
  });

  it("free messages remain after this one: null, and no extra read", async () => {
    checkFarahChatAllowance.mockResolvedValue(FREE_LEFT);
    const done = doneOf(await send());
    expect(done!.nextFreeMessageAt).toBeNull();
    expect(farahChatNextFreeMessageAt).not.toHaveBeenCalled();
  });

  it("covered by an active Pass: null, and no extra read", async () => {
    checkFarahChatAllowance.mockResolvedValue(PASS);
    const done = doneOf(await send());
    expect(done!.nextFreeMessageAt).toBeNull();
    expect(farahChatNextFreeMessageAt).not.toHaveBeenCalled();
  });

  it("a failed read (null) or a read that throws: the message still completes, is still charged once, and the field is null", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    farahChatNextFreeMessageAt.mockRejectedValue(new Error("db down"));
    const done = doneOf(await send());
    expect(done, "the reply must still complete").toBeTruthy();
    expect(done!.nextFreeMessageAt).toBeNull();
    expect(done!.persisted).toBe(true);
    expect(commitFarahChatAllowance).toHaveBeenCalledTimes(1);
  });

  it("the existing fields are unchanged beside it", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    commitFarahChatAllowance.mockResolvedValue({ balanceAfter: 40 });
    const done = doneOf(await send())!;
    expect(done).toMatchObject({ type: "done", id: "m9", persisted: true, freeMessagesRemaining: 0, creditsBalance: 40 });
    expect(Object.keys(done).sort()).toEqual(["createdAt", "creditsBalance", "freeMessagesRemaining", "id", "nextFreeMessageAt", "persisted", "type"]);
  });
});

describe("a failed message: nothing charged, no free message used, the date does not move", () => {
  it("the model fails: no commit (so no free-allowance event is written), no done event, and the next-free time is not even read", async () => {
    checkFarahChatAllowance.mockResolvedValue(LAST_FREE);
    askFarahChatStream.mockImplementation(async function* () {
      throw new Error("provider down");
      yield "x";
    });
    const events = await send();
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
    expect(doneOf(events)).toBeUndefined();
    expect(farahChatNextFreeMessageAt).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  it("a reply cut off at the length cap is not charged and uses no free message: the last free message is still left, so the field is null and nothing is read", async () => {
    checkFarahChatAllowance.mockResolvedValue(LAST_FREE); // 0 left AFTER this message = 1 left BEFORE it
    askFarahChatStream.mockImplementation(async function* (_turns: unknown, _extra: unknown, _max: unknown, opts?: { onFinish?: (r: string) => void }) {
      yield "Cut off";
      opts?.onFinish?.("length");
    });
    const done = doneOf(await send());
    expect(done).toMatchObject({ truncated: true, freeMessagesRemaining: 1 });
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
    expect(done!.nextFreeMessageAt).toBeNull();
    expect(farahChatNextFreeMessageAt).not.toHaveBeenCalled();
  });

  it("a cut-off reply that WOULD have been paid: still not charged; the free messages are used up either way, so the time is the one that already stands", async () => {
    checkFarahChatAllowance.mockResolvedValue(PAID);
    askFarahChatStream.mockImplementation(async function* (_turns: unknown, _extra: unknown, _max: unknown, opts?: { onFinish?: (r: string) => void }) {
      yield "Cut off";
      opts?.onFinish?.("length");
    });
    const done = doneOf(await send());
    expect(commitFarahChatAllowance).not.toHaveBeenCalled();
    expect(done!.nextFreeMessageAt).toBe(WHEN);
  });
});
