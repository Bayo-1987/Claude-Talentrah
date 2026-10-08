/**
 * sendAutoApplyDigest end to end, driven with a recording fake for the
 * service-role client — same standing rule as tests/digest/verification-
 * gate.test.ts: the digest is never self-tested against a real database or
 * a real mailer, so this exercises the ACTUAL query wiring with realistic
 * canned results, not a hand-rolled reimplementation of the query logic.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/flags/read", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/flags/read")>()),
  isFeatureEnabled: vi.fn(async () => true),
}));

const sentEmails = vi.hoisted(() => [] as { to: string; text: string; subject: string }[]);
const resendConfigured = vi.hoisted(() => ({ value: true }));

vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () =>
    resendConfigured.value
      ? {
          emails: {
            send: async (payload: { to: string; text: string; subject: string }) => {
              sentEmails.push(payload);
              return { data: { id: "mock" }, error: null };
            },
          },
        }
      : null,
}));

const fixtures = vi.hoisted(() => ({
  enabledSettings: [{ user_id: "seeker-1" }] as { user_id: string }[],
  recipients: [
    {
      user_id: "seeker-1",
      auto_apply_digest_last_sent_at: null as string | null,
      profiles: { email: "seeker@example.test", first_name: "Ada" },
    },
  ],
  autoApplyQueue: [
    {
      status: "submitted",
      queued_at: "2026-09-03T12:00:00.000Z",
      job_posting_id: "job-a",
      match_score: 92,
      job_postings: { title: "Backend Engineer", company_name: "Zaria Digital" },
    },
    {
      status: "handed_off",
      queued_at: "2026-09-04T12:00:00.000Z",
      job_posting_id: "job-b",
      match_score: 88,
      job_postings: { title: "Data Analyst", company_name: "Moniepoint" },
    },
    {
      status: "dismissed",
      queued_at: "2026-09-05T12:00:00.000Z",
      job_posting_id: "job-c",
      match_score: 90,
      job_postings: { title: "SRE", company_name: "Wave" },
    },
  ] as Array<{
    status: string;
    queued_at: string;
    job_posting_id: string;
    match_score: number;
    job_postings: { title: string; company_name: string };
  }>,
  matchScores: [
    { job_posting_id: "job-a", explanation: { matchedSkills: ["sql", "python", "aws", "docker", "kubernetes"], missingSkills: [] } },
    { job_posting_id: "job-b", explanation: { matchedSkills: ["sql", "python", "aws", "docker", "kubernetes"], missingSkills: [] } },
    { job_posting_id: "job-c", explanation: { matchedSkills: ["sql", "python", "aws", "docker", "kubernetes"], missingSkills: [] } },
  ],
}));

const updates = vi.hoisted(() => [] as { table: string; payload: unknown }[]);

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      let isUpdate = false;
      let updatePayload: unknown;
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        or: () => chain,
        gte: () => chain,
        in: () => chain,
        limit: () => chain,
        update: (payload: unknown) => {
          isUpdate = true;
          updatePayload = payload;
          return chain;
        },
      };
      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => {
        if (isUpdate) {
          updates.push({ table, payload: updatePayload });
          return Promise.resolve({ error: null }).then(resolve);
        }
        const data =
          table === "auto_apply_settings"
            ? fixtures.enabledSettings
            : table === "email_preferences"
              ? fixtures.recipients
              : table === "auto_apply_queue"
                ? fixtures.autoApplyQueue
                : table === "match_scores"
                  ? fixtures.matchScores
                  : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return chain;
    },
  }),
}));

import { sendAutoApplyDigest } from "@/lib/auto-apply-digest/send";

/** Fixed so the 7-day window lines up with the fixture queue entries below, regardless of the real current date. */
const TEST_NOW = new Date("2026-09-08T00:00:00.000Z");

beforeEach(() => {
  sentEmails.length = 0;
  updates.length = 0;
  resendConfigured.value = true;
  fixtures.enabledSettings = [{ user_id: "seeker-1" }];
  fixtures.recipients = [
    {
      user_id: "seeker-1",
      auto_apply_digest_last_sent_at: null,
      profiles: { email: "seeker@example.test", first_name: "Ada" },
    },
  ];
});

describe("RESEND_API_KEY gate", () => {
  it("sends nothing, and reports why, when the mailer is not configured", async () => {
    resendConfigured.value = false;
    const summary = await sendAutoApplyDigest(TEST_NOW);
    expect(sentEmails).toHaveLength(0);
    expect(summary.reason).toMatch(/mailer|resend/i);
  });
});

describe("auto_apply_settings.enabled — checked live, not historically", () => {
  it("sends nothing when no one currently has Auto-Apply enabled", async () => {
    fixtures.enabledSettings = [];
    const summary = await sendAutoApplyDigest(TEST_NOW);
    expect(sentEmails).toHaveLength(0);
    expect(summary.enabled).toBe(true);
    // A legitimately empty run, not a failure — same treatment as zero recipients.
    expect(summary.reason).toBeUndefined();
  });
});

describe("a real mixed week — end to end", () => {
  it("sends one email covering submitted, handed off, and dismissed", async () => {
    const summary = await sendAutoApplyDigest(TEST_NOW);
    expect(summary.sent).toBe(1);
    expect(sentEmails).toHaveLength(1);
    const [email] = sentEmails;
    expect(email.to).toBe("seeker@example.test");
    expect(email.text).toContain("Farah queued 3 applications for your review this week.");
    expect(email.text).toContain("Backend Engineer");
    expect(email.text).toContain("Data Analyst");
    expect(email.text).toContain("1 didn't make the cut when you reviewed it.");
  });

  it("stamps auto_apply_digest_last_sent_at only after a successful send", async () => {
    await sendAutoApplyDigest(TEST_NOW);
    const stamp = updates.find((u) => u.table === "email_preferences");
    expect(stamp, "no stamp was written after a successful send").toBeDefined();
    expect(stamp!.payload).toHaveProperty("auto_apply_digest_last_sent_at");
  });
});

describe("a genuinely quiet week", () => {
  it("sends nothing and does NOT stamp — so a quiet week never suppresses a future one", async () => {
    fixtures.autoApplyQueue = [];
    const summary = await sendAutoApplyDigest(TEST_NOW);
    expect(sentEmails).toHaveLength(0);
    expect(summary.skippedNothingHappened).toBe(1);
    const stamp = updates.find((u) => u.table === "email_preferences");
    expect(stamp, "a quiet week must not stamp last_sent_at").toBeUndefined();
  });
});
