/**
 * The switch that keeps the digest switched off.
 *
 * ── WHY THIS IS THE MOST IMPORTANT TEST IN THE FEATURE ────────────────────
 *
 * The digest is shipping deliberately dark: built, merged, and sending
 * nothing until someone decides otherwise. The ONLY thing standing between
 * that decision and real email reaching real people is
 * `isFeatureEnabled("job_match_digest")`.
 *
 * So this asserts more than "it did not send". It asserts the run does not
 * even READ a recipient while the flag is off — because a version that
 * gathers everybody and then declines to mail them is one refactor away from
 * mailing them, and because the failure mode is unrecoverable: you cannot
 * un-send.
 *
 * NOTHING HERE TOUCHES A REAL MAILER OR A REAL ADDRESS. Resend and the
 * database client are both mocked; the standing rule on this project is that
 * a digest is never self-tested against a real user, and a test that could
 * accidentally do so is not worth the coverage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const flagValue = vi.hoisted(() => ({ enabled: false }));
const sentEmails = vi.hoisted(() => [] as unknown[]);
const tablesRead = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/flags/read", () => ({
  isFeatureEnabled: vi.fn(async () => flagValue.enabled),
}));

vi.mock("@/lib/resend/client", () => ({
  getResendClient: () => ({
    emails: {
      send: async (payload: unknown) => {
        sentEmails.push(payload);
        return { data: { id: "mock" }, error: null };
      },
    },
  }),
  getContactRecipient: () => "support@talentrah.test",
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      tablesRead.push(table);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "or", "gte", "in", "limit", "update"]) {
        chain[m] = () => chain;
      }
      // Terminal: resolves to an empty set, so a run that gets this far does
      // no work but also does not throw — the point is whether it got here.
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null });
      return chain;
    },
  }),
}));

import { sendJobMatchDigest } from "@/lib/digest/send";

beforeEach(() => {
  sentEmails.length = 0;
  tablesRead.length = 0;
  flagValue.enabled = false;
});

describe("with the flag off — today's shipped state", () => {
  it("sends nothing", async () => {
    const summary = await sendJobMatchDigest();
    expect(sentEmails, "the digest sent email while the feature was off").toHaveLength(0);
    expect(summary.sent).toBe(0);
    expect(summary.enabled).toBe(false);
  });

  it("does not even read a recipient", async () => {
    /*
     * The stronger claim, and the one that survives a refactor. Gathering
     * recipients and then declining to mail them would satisfy the test above
     * while leaving the send one edit away.
     */
    await sendJobMatchDigest();
    expect(tablesRead, "the run queried the database despite the flag being off").toEqual([]);
  });

  it("reports why, rather than looking like a quiet week", async () => {
    // A run that chose not to send and a run that had nothing to send are
    // different states, and the summary has to tell them apart.
    const summary = await sendJobMatchDigest();
    expect(summary.reason).toMatch(/flag/i);
  });
});

describe("with the flag on", () => {
  it("proceeds far enough to read recipients", async () => {
    /*
     * The positive control. Without it, a gate that returns early
     * unconditionally — or an isFeatureEnabled stuck at false — passes every
     * assertion above while the feature could never work at all.
     */
    flagValue.enabled = true;
    const summary = await sendJobMatchDigest();
    expect(summary.enabled).toBe(true);
    expect(tablesRead, "an enabled run never reached the recipient query").toContain(
      "email_preferences",
    );
  });

  it("still sends nothing when there are no recipients", async () => {
    flagValue.enabled = true;
    await sendJobMatchDigest();
    expect(sentEmails).toHaveLength(0);
  });
});
