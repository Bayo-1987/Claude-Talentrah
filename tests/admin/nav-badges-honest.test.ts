/**
 * The admin navigation badges count what needs a person, and stale or irrelevant items stop counting (owner decision 8 Oct: Finance option A, Operations "never seen" after a day, Courses active only).
 *
 *   FINANCE: only a pending payment between 30 minutes and 24 hours old counts. Under 30 minutes it is a checkout still open (counted nowhere); over 24 hours it leaves the badge but stays visible as
 *     its own "stale" line on the Finance page (a pending row that old may be a real charge with a lost webhook, so it must never be invisible). The boundaries are pinned at both edges.
 *   OPERATIONS: a configured source that has never produced a posting counts only once it has been configured for more than 24 hours; a source with no date counts (old by default). Money items,
 *     an exhausted renewal and a mentor payment needing a refund, count however old they are.
 *   COURSES: only ACTIVE courses with a placeholder link are outstanding work.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  payments: [] as Array<{ status: string; rail: string; amount: number; currency: string; created_at: string }>,
  courseCalls: [] as Array<[string, unknown[]]>,
  passRows: [] as Array<Record<string, unknown>>,
  refundRows: [] as Array<Record<string, unknown>>,
  postings: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === "then") {
              const data =
                table === "payment_transactions" ? state.payments
                : table === "user_passes" ? state.passRows
                : table === "mentorship_sessions" ? state.refundRows
                : table === "job_postings" ? state.postings
                : [];
              return (resolve: (v: unknown) => unknown) => resolve({ data, error: null, count: table === "course_recommendations" ? 0 : null });
            }
            return (...args: unknown[]) => {
              if (table === "course_recommendations") state.courseCalls.push([String(prop), args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
    rpc: async () => ({ data: [], error: null }),
  }),
}));

import { classifyPending, financialHealth } from "@/lib/admin/finance/queries";
import { countsAsNeverSeen, opsAttentionCount } from "@/lib/admin/ops/queries";
import { placeholderCourseCount } from "@/lib/admin/catalog/courses";

const NOW = new Date("2026-10-08T12:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

beforeEach(() => {
  state.payments = [];
  state.courseCalls = [];
  state.passRows = [];
  state.refundRows = [];
  state.postings = [];
});

describe("classifyPending: the three age bands, both edges pinned", () => {
  it.each([
    [10 * MIN, "recent"],
    [30 * MIN - 1, "recent"],
    [30 * MIN, "counted"],
    [5 * HOUR, "counted"],
    [24 * HOUR, "counted"],
    [24 * HOUR + 1, "stale"],
    [25 * HOUR, "stale"],
    [30 * 24 * HOUR, "stale"],
  ])("a pending payment %i ms old is %s", (age, band) => {
    expect(classifyPending(ago(age), NOW)).toBe(band);
  });
  it("an unreadable date is counted (never silently dropped)", () => {
    expect(classifyPending("not a date", NOW)).toBe("counted");
  });
});

describe("financialHealth: the badge number and the stale line", () => {
  const pending = (age: number) => ({ status: "pending", rail: "paystack", amount: 250_000, currency: "NGN", created_at: ago(age) });
  it("a 25 h pending row is on the stale line and NOT in the badge; a 10 min row counts nowhere; a 2 h row is the badge", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      state.payments = [pending(25 * HOUR), pending(10 * MIN), pending(2 * HOUR)];
      const h = await financialHealth();
      expect(h.pendingCounted, "the badge").toBe(1);
      expect(h.stalePending, "the stale line").toBe(1);
      expect(h.pendingRecent, "an open checkout").toBe(1);
      expect(h.pendingCount, "every pending row, for the page").toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
  it("the stale line is there when the badge is 0 (a stale pending row is never invisible)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      state.payments = [pending(48 * HOUR), pending(72 * HOUR)];
      const h = await financialHealth();
      expect(h.pendingCounted).toBe(0);
      expect(h.stalePending).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Operations: a source configured under 24 h is not 'never seen' yet; money items count however old", () => {
  const feed = (over: Record<string, unknown>) => ({ configured: true, lastCheckedAt: null as string | null, configuredAt: null as string | null, ...over });
  it("never seen, configured 2 h ago: not counted", () => expect(countsAsNeverSeen(feed({ configuredAt: ago(2 * HOUR) }), NOW)).toBe(false));
  it("never seen, configured 30 h ago: counted", () => expect(countsAsNeverSeen(feed({ configuredAt: ago(30 * HOUR) }), NOW)).toBe(true));
  it("never seen, exactly 24 h: counted (the first moment it is old enough)", () => expect(countsAsNeverSeen(feed({ configuredAt: ago(24 * HOUR) }), NOW)).toBe(true));
  it("never seen, no configuration date: counted (old by default)", () => expect(countsAsNeverSeen(feed({}), NOW)).toBe(true));
  it("already seen: not counted; not configured: not counted", () => {
    expect(countsAsNeverSeen(feed({ lastCheckedAt: ago(HOUR) }), NOW)).toBe(false);
    expect(countsAsNeverSeen(feed({ configured: false }), NOW)).toBe(false);
  });
  it("an exhausted renewal and a mentor payment needing a refund count however old they are", async () => {
    state.passRows = [
      { id: "p1", renewal_attempt_count: 3, auto_renew_status: "active", next_renewal_date: "2026-01-01", last_renewal_failure_at: "2026-01-02T00:00:00Z", pending_renewal_reference: "ref1", profiles: { email: "x@example.test" } },
    ];
    state.refundRows = [{ id: "s1", price_ngn: 25_000, updated_at: "2025-01-01T00:00:00.000Z", scheduled_start: "2025-01-01T00:00:00.000Z" }];
    const n = await opsAttentionCount();
    expect(n).toBeGreaterThanOrEqual(2);
  });
});

describe("Courses: only active placeholder links count", () => {
  it("the count query filters on active = true", async () => {
    await placeholderCourseCount();
    const eq = state.courseCalls.filter(([m]) => m === "eq");
    expect(eq.some(([, args]) => (args as unknown[])[0] === "active" && (args as unknown[])[1] === true), "active = true").toBe(true);
    expect(state.courseCalls.some(([m, args]) => m === "like" && String((args as unknown[])[1]).includes("ref=talentrah-placeholder"))).toBe(true);
  });
});
