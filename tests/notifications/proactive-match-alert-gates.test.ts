/**
 * The three switches that keep send-138's proactive alert off — mirrors
 * tests/digest/flag-gate.test.ts's own reasoning and shape exactly, on this
 * alert's OWN flag and OWN preference column rather than the digest's.
 *
 * Nothing here touches a real mailer or a real database — both are mocked,
 * matching this project's standing rule that a notification pipeline is
 * never self-tested against a real user.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const flagValue = vi.hoisted(() => ({ enabled: false }));
const resendConfigured = vi.hoisted(() => ({ value: true }));
const sentEmails = vi.hoisted(() => [] as unknown[]);
const tablesRead = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/flags/read", () => ({
  isFeatureEnabled: vi.fn(async () => flagValue.enabled),
}));

vi.mock("@/lib/resend/client", () => ({
  getResendClient: () =>
    resendConfigured.value
      ? {
          emails: {
            send: async (payload: unknown) => {
              sentEmails.push(payload);
              return { data: { id: "mock" }, error: null };
            },
          },
        }
      : null,
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      tablesRead.push(table);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "in", "limit", "insert", "maybeSingle"]) {
        chain[m] = () => chain;
      }
      // Terminal: resolves to an empty set, same as flag-gate.test.ts's own
      // fake — a run that gets this far does no work but does not throw.
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null });
      return chain;
    },
  }),
}));

import { sendProactiveMatchAlerts } from "@/lib/notifications/proactive-match-alert/send";

const SINCE = "2026-09-10T00:00:00.000Z";

beforeEach(() => {
  sentEmails.length = 0;
  tablesRead.length = 0;
  flagValue.enabled = false;
  resendConfigured.value = true;
});

describe("with the flag off", () => {
  it("sends nothing", async () => {
    const summary = await sendProactiveMatchAlerts(SINCE);
    expect(sentEmails, "sent email while the feature was off").toHaveLength(0);
    expect(summary.sent).toBe(0);
    expect(summary.enabled).toBe(false);
  });

  it("does not even query the database", async () => {
    // The stronger claim, and the one that survives a refactor — see
    // flag-gate.test.ts's own header for why this matters more than the
    // assertion above.
    await sendProactiveMatchAlerts(SINCE);
    expect(tablesRead, "queried the database despite the flag being off").toEqual([]);
  });

  it("reports why, rather than looking like a quiet run", async () => {
    const summary = await sendProactiveMatchAlerts(SINCE);
    expect(summary.reason).toMatch(/flag/i);
  });
});

describe("with the flag on but RESEND_API_KEY not configured", () => {
  beforeEach(() => {
    flagValue.enabled = true;
    resendConfigured.value = false;
  });

  it("sends nothing and does not query for new postings either", async () => {
    const summary = await sendProactiveMatchAlerts(SINCE);
    expect(sentEmails).toHaveLength(0);
    expect(summary.reason).toMatch(/mailer|resend/i);
    expect(tablesRead).toEqual([]);
  });
});

describe("with the flag on and the mailer configured", () => {
  beforeEach(() => {
    flagValue.enabled = true;
  });

  it("proceeds far enough to query for this run's new postings", async () => {
    const summary = await sendProactiveMatchAlerts(SINCE);
    expect(summary.enabled).toBe(true);
    expect(tablesRead, "an enabled run never reached the new-postings query").toContain("job_postings");
  });

  it("still sends nothing when there are no new postings this run", async () => {
    const summary = await sendProactiveMatchAlerts(SINCE);
    expect(sentEmails).toHaveLength(0);
    expect(summary.sent).toBe(0);
    // No new postings to score means no reason to ever read a candidate —
    // the same "don't gather people you're not going to mail" discipline
    // flag-gate.test.ts asserts for the digest.
    expect(tablesRead).not.toContain("email_preferences");
  });
});
