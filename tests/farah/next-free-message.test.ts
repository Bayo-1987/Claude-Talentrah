/**
 * When does a free Farah message come back?
 *
 * The allowance is 3 free messages in a ROLLING 30 days (chat-gate.ts: a message counts while `created_at >= now - 30 days`; never a calendar month). Each used message returns exactly 30 days after the
 * moment it was logged, so the next one to come back is the OLDEST message still inside the window, plus 30 days. These tests pin that arithmetic (pure, `nextFreeMessageAt`), that it uses the SAME window
 * edge as the count the gate takes (`freeWindowStart`), and the one database read behind it (`farahChatNextFreeMessageAt`): which rows it asks for, and that a failed read is "unknown" (null), never a guess.
 *
 * It is display-only: it never decides whether a message is free (the gate's count does), so a failed read returns null instead of failing closed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FARAH_CHAT_FREE_ALLOWANCE, FARAH_CHAT_FREE_WINDOW_DAYS, freeWindowStart, nextFreeMessageAt } from "@/lib/farah/free-allowance";

const DAY = 86_400_000;
const NOW = new Date("2026-10-31T12:00:00.000Z");
const ago = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * DAY + extraMs);

describe("the constants a client can read", () => {
  it("3 free messages in a rolling 30 days", () => {
    expect(FARAH_CHAT_FREE_ALLOWANCE).toBe(3);
    expect(FARAH_CHAT_FREE_WINDOW_DAYS).toBe(30);
  });
});

describe("freeWindowStart: the one definition of the window's edge", () => {
  it("is exactly now minus 30 days", () => {
    expect(freeWindowStart(NOW).getTime()).toBe(NOW.getTime() - 30 * DAY);
  });
});

describe("nextFreeMessageAt (pure)", () => {
  it("nothing used in the window: nothing is coming back, so null", () => {
    expect(nextFreeMessageAt([], NOW)).toBeNull();
  });

  it("one message used 10 days ago: it comes back in 20 days", () => {
    expect(nextFreeMessageAt([ago(10)], NOW)?.toISOString()).toBe(new Date(NOW.getTime() + 20 * DAY).toISOString());
  });

  it("three used (day 1, 15 and 29 of the window): the OLDEST decides, 30 days after it", () => {
    const used = [ago(15), ago(29), ago(1)]; // deliberately not in order
    expect(nextFreeMessageAt(used, NOW)?.toISOString()).toBe(new Date(NOW.getTime() + 1 * DAY).toISOString());
  });

  it("it is rolling, not a calendar month: a message used on the 31st at 08:00 comes back 30 days later, not on the 1st", () => {
    const used = [new Date("2026-10-31T08:00:00Z")];
    expect(nextFreeMessageAt(used, NOW)?.toISOString()).toBe("2026-11-30T08:00:00.000Z");
  });

  it("a message used exactly 30 days ago is still inside the window (the gate counts created_at >= now - 30 days): it comes back right now", () => {
    expect(nextFreeMessageAt([ago(30)], NOW)?.toISOString()).toBe(NOW.toISOString());
  });

  it("one millisecond older than that is outside the window and is ignored", () => {
    expect(nextFreeMessageAt([ago(30, -1)], NOW)).toBeNull();
    expect(nextFreeMessageAt([ago(30, -1), ago(5)], NOW)?.toISOString()).toBe(new Date(NOW.getTime() + 25 * DAY).toISOString());
  });

  it("a time in the future, an invalid date or garbage is ignored, never returned", () => {
    expect(nextFreeMessageAt([new Date(NaN), "not a date" as unknown as Date], NOW)).toBeNull();
    expect(nextFreeMessageAt([new Date(NOW.getTime() + DAY)], NOW)).toBeNull();
  });

  it("accepts ISO strings, as the database returns them", () => {
    expect(nextFreeMessageAt([ago(10).toISOString()], NOW)?.toISOString()).toBe(new Date(NOW.getTime() + 20 * DAY).toISOString());
  });

  it("agrees with the window edge the gate counts with: a time counts exactly when it is >= freeWindowStart", () => {
    for (const offset of [-2, -1, 0, 1, 2]) {
      const t = new Date(freeWindowStart(NOW).getTime() + offset);
      expect(nextFreeMessageAt([t], NOW) !== null, `offset ${offset} ms`).toBe(offset >= 0);
    }
  });
});

/* The one database read. */
const calls: Array<[string, ...unknown[]]> = [];
let result: { data: Array<{ created_at: string }> | null; error: { message: string } | null } = { data: [], error: null };
function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "order", "limit"]) c[m] = (...a: unknown[]) => (calls.push([m, ...a]), c);
  (c as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(result);
  return c;
}
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ from: (t: string) => (calls.push(["from", t]), chain()) }) }));
vi.mock("@/lib/passes/entitlement", () => ({ checkPassCoverage: async () => ({ covered: false, reason: "no_pass" }), DAILY_CAP_MESSAGE: "cap" }));
vi.mock("@/lib/credits/gate-events", () => ({ logCreditGateEvent: async () => undefined }));
vi.mock("@/lib/credits/spend", () => ({ spendCredits: async () => ({ balanceAfter: 0 }), InsufficientCreditsError: class extends Error {} }));

describe("farahChatNextFreeMessageAt (the read)", () => {
  beforeEach(() => {
    calls.length = 0;
    result = { data: [], error: null };
  });

  it("asks credit_gate_events for this user's free-allowance messages in the window, oldest first, one row", async () => {
    const { farahChatNextFreeMessageAt } = await import("@/lib/farah/chat-gate");
    result = { data: [{ created_at: ago(10).toISOString() }], error: null };
    await farahChatNextFreeMessageAt("user-1", NOW);
    expect(calls).toContainEqual(["from", "credit_gate_events"]);
    expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(calls).toContainEqual(["eq", "reason", "farah_chat_message"]);
    expect(calls).toContainEqual(["eq", "outcome", "covered_by_free_allowance"]);
    expect(calls).toContainEqual(["gte", "created_at", freeWindowStart(NOW).toISOString()]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: true }]);
    expect(calls).toContainEqual(["limit", 1]);
  });

  it("returns the oldest in-window message's time plus 30 days, as an ISO string", async () => {
    const { farahChatNextFreeMessageAt } = await import("@/lib/farah/chat-gate");
    result = { data: [{ created_at: ago(10).toISOString() }], error: null };
    expect(await farahChatNextFreeMessageAt("user-1", NOW)).toBe(new Date(NOW.getTime() + 20 * DAY).toISOString());
  });

  it("no message in the window: null", async () => {
    const { farahChatNextFreeMessageAt } = await import("@/lib/farah/chat-gate");
    expect(await farahChatNextFreeMessageAt("user-1", NOW)).toBeNull();
  });

  it("a failed read is null (unknown), never a guessed date, and the log line names no user", async () => {
    const { farahChatNextFreeMessageAt } = await import("@/lib/farah/chat-gate");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    result = { data: null, error: { message: "boom" } };
    expect(await farahChatNextFreeMessageAt("user-secret-id", NOW)).toBeNull();
    expect(spy.mock.calls.flat().join(" ")).not.toContain("user-secret-id");
    spy.mockRestore();
  });
});
