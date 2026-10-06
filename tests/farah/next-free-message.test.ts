/**
 * When does a free Farah message come back?
 *
 * The allowance is 3 free messages in a ROLLING 30 days (chat-gate.ts: a message counts while `created_at >= now - 30 days`; never a calendar month). Each used message returns exactly 30 days after the
 * moment it was logged. A person is free again when fewer than 3 messages are inside the window, so with n messages inside it the next free message is the (n - 3 + 1)th oldest, plus 30 days: the
 * oldest when n is 3, the second oldest when n is 4 (parallel requests can push the count past 3: chat-gate-concurrent-commit.test.ts characterises that, it is not fixed here). Fewer than 3 inside the
 * window means a free message is already left, so there is nothing to wait for (null). These tests pin that arithmetic (pure, `nextFreeMessageAt`), that it uses the SAME window edge as the count the gate
 * takes (`freeWindowStart`), and the one database read behind it (`farahChatNextFreeMessageAt`): which rows it asks for, and that a failed read is "unknown" (null), never a guess.
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
  const iso = (d: Date) => d.toISOString();
  const inDays = (d: number) => iso(new Date(NOW.getTime() + d * DAY));

  it("nothing used in the window: nothing is coming back, so null", () => {
    expect(nextFreeMessageAt([], NOW)).toBeNull();
  });

  it("fewer than 3 used in the window: a free message is already left, so there is nothing to wait for (null)", () => {
    expect(nextFreeMessageAt([ago(10)], NOW)).toBeNull();
    expect(nextFreeMessageAt([ago(10), ago(20)], NOW)).toBeNull();
  });

  it("three used (day 1, 15 and 29 of the window): the OLDEST decides, 30 days after it", () => {
    const used = [ago(15), ago(29), ago(1)]; // deliberately not in order
    expect(iso(nextFreeMessageAt(used, NOW)!)).toBe(inDays(1));
  });

  it("FOUR in the window (over-committed): the SECOND oldest decides, because the oldest leaving still leaves 3", () => {
    const used = [ago(10), ago(29), ago(1), ago(20)];
    expect(iso(nextFreeMessageAt(used, NOW)!)).toBe(inDays(10)); // day 20 + 30 days, NOT day 29 + 30 days (that day the count would be 3, still not free)
  });

  it("FIVE in the window: the THIRD oldest decides", () => {
    const used = [ago(1), ago(25), ago(29), ago(10), ago(20)];
    expect(iso(nextFreeMessageAt(used, NOW)!)).toBe(inDays(10));
  });

  it("several rows at the same instant: the sorted position decides, ties do not shift it", () => {
    expect(iso(nextFreeMessageAt([ago(29), ago(20), ago(20), ago(1)], NOW)!)).toBe(inDays(10)); // 4 rows: second oldest is the first of the tied pair
    expect(iso(nextFreeMessageAt([ago(5), ago(5), ago(5)], NOW)!)).toBe(inDays(25)); // 3 rows at one instant
    expect(iso(nextFreeMessageAt([ago(29), ago(29), ago(29), ago(29)], NOW)!)).toBe(inDays(1)); // 4 rows at one instant
  });

  it("the answer is when the blocking message turns exactly 30 days old: one millisecond before it 3 or more count, one millisecond after it fewer than 3 do", () => {
    const lists: number[][] = [
      [29, 15, 1],
      [29, 20, 10, 1],
      [29, 25, 20, 10, 1],
      [29, 20, 20, 1],
      [5, 5, 5, 5, 5, 5],
      [29, 29, 20, 20, 10, 10, 1],
    ];
    const countAt = (used: Date[], moment: number) => used.filter((u) => u.getTime() >= moment - 30 * DAY).length; // the gate's own rule: created_at >= moment - 30 days
    for (const days of lists) {
      const used = days.map((d) => ago(d));
      const when = nextFreeMessageAt(used, NOW)!.getTime();
      expect(countAt(used, when + 1), JSON.stringify(days)).toBeLessThan(FARAH_CHAT_FREE_ALLOWANCE); // a message exactly 30 days old still counts (>=), so the gate frees it 1 ms later
      expect(countAt(used, when - 1), JSON.stringify(days)).toBeGreaterThanOrEqual(FARAH_CHAT_FREE_ALLOWANCE);
    }
  });

  it("it is rolling, not a calendar month: three used on the 31st at 08:00 come back 30 days later, not on the 1st", () => {
    const used = [new Date("2026-10-31T08:00:00Z"), new Date("2026-10-31T08:00:00Z"), new Date("2026-10-31T08:00:00Z")];
    expect(iso(nextFreeMessageAt(used, NOW)!)).toBe("2026-11-30T08:00:00.000Z");
  });

  it("a message used exactly 30 days ago is still inside the window (the gate counts created_at >= now - 30 days): with 3 of them it comes back right now", () => {
    expect(iso(nextFreeMessageAt([ago(30), ago(30), ago(30)], NOW)!)).toBe(iso(NOW));
  });

  it("one millisecond older than that is outside the window and is not counted", () => {
    expect(nextFreeMessageAt([ago(30, -1), ago(30, -1), ago(30, -1)], NOW)).toBeNull();
    expect(iso(nextFreeMessageAt([ago(30, -1), ago(5), ago(5), ago(5)], NOW)!)).toBe(inDays(25));
  });

  it("an invalid date or garbage is ignored, never counted or returned", () => {
    expect(nextFreeMessageAt([new Date(NaN), "not a date" as unknown as Date], NOW)).toBeNull();
    expect(iso(nextFreeMessageAt([new Date(NaN), ago(20), ago(10), ago(1)], NOW)!)).toBe(inDays(10));
    expect(nextFreeMessageAt([new Date(NaN), "garbage" as unknown as Date, ago(20), ago(10)], NOW)).toBeNull(); // only 2 real rows: garbage must not make it 3 or 4
  });

  it("a time slightly in the FUTURE still counts, as it does for the gate (its query has no upper bound): the database clock can run ahead of this server's", () => {
    // The newest row is 1 s ahead of this server's clock. Ignoring it would make this a 2-row list (null) or shift the position of a longer one.
    expect(iso(nextFreeMessageAt([ago(20), ago(10), new Date(NOW.getTime() + 1000)], NOW)!)).toBe(inDays(10));
    expect(iso(nextFreeMessageAt([ago(29), ago(10), new Date(NOW.getTime() + 1000), new Date(NOW.getTime() + 2000)], NOW)!)).toBe(inDays(20));
  });

  it("accepts ISO strings, as the database returns them", () => {
    expect(iso(nextFreeMessageAt([ago(20).toISOString(), ago(10).toISOString(), ago(1).toISOString()], NOW)!)).toBe(inDays(10));
  });

  it("agrees with the window edge the gate counts with: a time counts exactly when it is >= freeWindowStart", () => {
    for (const offset of [-2, -1, 0, 1, 2]) {
      const t = new Date(freeWindowStart(NOW).getTime() + offset);
      expect(nextFreeMessageAt([t, t, t], NOW) !== null, `offset ${offset} ms`).toBe(offset >= 0);
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

  it("asks credit_gate_events for this user's free-allowance messages in the window, NEWEST first, only as many as the allowance (3)", async () => {
    const { farahChatNextFreeMessageAt } = await import("@/lib/farah/chat-gate");
    result = { data: [{ created_at: ago(10).toISOString() }], error: null };
    await farahChatNextFreeMessageAt("user-1", NOW);
    expect(calls).toContainEqual(["from", "credit_gate_events"]);
    expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(calls).toContainEqual(["eq", "reason", "farah_chat_message"]);
    expect(calls).toContainEqual(["eq", "outcome", "covered_by_free_allowance"]);
    expect(calls).toContainEqual(["gte", "created_at", freeWindowStart(NOW).toISOString()]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", FARAH_CHAT_FREE_ALLOWANCE]);
    expect(FARAH_CHAT_FREE_ALLOWANCE).toBe(3);
    expect(calls.filter((c) => c[0] === "limit")).toHaveLength(1);
  });

  it("the 3 newest in the window (here exactly 3): the oldest of them plus 30 days, as an ISO string", async () => {
    const { farahChatNextFreeMessageAt } = await import("@/lib/farah/chat-gate");
    result = { data: [ago(1), ago(10), ago(20)].map((d) => ({ created_at: d.toISOString() })), error: null }; // newest first, as the read returns them
    expect(await farahChatNextFreeMessageAt("user-1", NOW)).toBe(new Date(NOW.getTime() + 10 * DAY).toISOString());
  });

  it("over-committed (the read returns the 3 newest of 4 or more): the oldest of THOSE three, which is the (n - 3 + 1)th oldest overall", async () => {
    const { farahChatNextFreeMessageAt } = await import("@/lib/farah/chat-gate");
    // the window holds 25, 20, 10 and 1 days ago; the read returns the three newest, newest first. The 25-day-old row is not returned and must not matter.
    result = { data: [ago(1), ago(10), ago(20)].map((d) => ({ created_at: d.toISOString() })), error: null };
    expect(await farahChatNextFreeMessageAt("user-1", NOW)).toBe(new Date(NOW.getTime() + 10 * DAY).toISOString());
  });

  it("does not trust the order the rows arrive in (the function sorts for itself)", async () => {
    const { farahChatNextFreeMessageAt } = await import("@/lib/farah/chat-gate");
    result = { data: [ago(10), ago(20), ago(1)].map((d) => ({ created_at: d.toISOString() })), error: null };
    expect(await farahChatNextFreeMessageAt("user-1", NOW)).toBe(new Date(NOW.getTime() + 10 * DAY).toISOString());
  });

  it("fewer than 3 in the window: null (a free message is already left)", async () => {
    const { farahChatNextFreeMessageAt } = await import("@/lib/farah/chat-gate");
    result = { data: [{ created_at: ago(10).toISOString() }], error: null };
    expect(await farahChatNextFreeMessageAt("user-1", NOW)).toBeNull();
    result = { data: [ago(1), ago(10)].map((d) => ({ created_at: d.toISOString() })), error: null };
    expect(await farahChatNextFreeMessageAt("user-1", NOW)).toBeNull();
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
