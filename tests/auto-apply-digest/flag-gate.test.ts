/**
 * The switch that keeps the Auto-Apply digest switched off — same shape and
 * same reasoning as tests/digest/flag-gate.test.ts: the digest ships
 * deliberately dark (migration 0195 inserts the `auto_apply_digest` feature
 * flag row with `enabled: false`), and `isFeatureEnabled("auto_apply_digest")`
 * is the only thing standing between that and real email reaching real
 * people. Asserts the run does not even READ a table while the flag is off —
 * a version that gathers recipients and then declines to mail them is one
 * refactor away from mailing them.
 *
 * Nothing here touches a real mailer or a real database — both are mocked,
 * same standing rule as the match digest's own test.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const flagValue = vi.hoisted(() => ({ enabled: false }));
const sentEmails = vi.hoisted(() => [] as unknown[]);
const tablesRead = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/flags/read", () => ({
  isFeatureEnabled: vi.fn(async () => flagValue.enabled),
}));

vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () => ({
    emails: {
      send: async (payload: unknown) => {
        sentEmails.push(payload);
        return { data: { id: "mock" }, error: null };
      },
    },
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      tablesRead.push(table);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "or", "gte", "in", "limit", "update"]) {
        chain[m] = () => chain;
      }
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null });
      return chain;
    },
  }),
}));

import { sendAutoApplyDigest } from "@/lib/auto-apply-digest/send";

beforeEach(() => {
  sentEmails.length = 0;
  tablesRead.length = 0;
  flagValue.enabled = false;
});

describe("with the flag off — today's shipped state", () => {
  it("sends nothing", async () => {
    const summary = await sendAutoApplyDigest();
    expect(sentEmails, "the digest sent email while the feature was off").toHaveLength(0);
    expect(summary.sent).toBe(0);
    expect(summary.enabled).toBe(false);
  });

  it("does not even read a table", async () => {
    await sendAutoApplyDigest();
    expect(tablesRead, "the run queried the database despite the flag being off").toEqual([]);
  });

  it("reports why, rather than looking like a quiet week", async () => {
    const summary = await sendAutoApplyDigest();
    expect(summary.reason).toMatch(/flag/i);
  });
});

describe("with the flag on", () => {
  it("proceeds far enough to read auto_apply_settings", async () => {
    /*
     * The positive control — without it, a gate that returns early
     * unconditionally passes every assertion above while the feature could
     * never work at all.
     */
    flagValue.enabled = true;
    const summary = await sendAutoApplyDigest();
    expect(summary.enabled).toBe(true);
    expect(tablesRead, "an enabled run never reached auto_apply_settings").toContain("auto_apply_settings");
  });

  it("still sends nothing when no one has Auto-Apply enabled", async () => {
    flagValue.enabled = true;
    await sendAutoApplyDigest();
    expect(sentEmails).toHaveLength(0);
  });
});
