/**
 * send-138's proactive alert, driven end to end through `sendProactiveMatchAlerts`
 * with a mocked service-role client and a mocked scorer — matching this
 * project's standing pattern for the digest (verification-gate.test.ts): the
 * assertion is against the ACTUAL query wiring and eligibility logic, not
 * just the pure helpers in select.ts, while still touching nothing real.
 *
 * `computeMatchScore` itself is mocked rather than exercised for real — its
 * own correctness is covered in tests/matching/. What THESE tests prove is
 * the pipeline built around it: who gets scored, who gets skipped, and what
 * happens once a score comes back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentEmails = vi.hoisted(() => [] as { to: string; text: string }[]);
const insertedNotifications = vi.hoisted(() => [] as { user_id: string; title: string }[]);
const insertedAlertLocks = vi.hoisted(() => [] as { user_id: string; job_posting_id: string }[]);
/** jobId -> score, so each test controls exactly what the "match" is without
 * depending on the real scoring algorithm's behaviour. */
const scoreByJob = vi.hoisted(() => new Map<string, number>());
/** (userId, jobId) pairs that should simulate an already-existing lock row
 * — i.e. the unique-constraint conflict this alert relies on to dedupe. */
const preLockedPairs = vi.hoisted(() => new Set<string>());

vi.mock("@/lib/flags/read", () => ({ isFeatureEnabled: vi.fn(async () => true) }));

vi.mock("@/lib/resend/client", () => ({
  getResendClient: () => ({
    emails: {
      send: async (payload: { to: string; text: string }) => {
        sentEmails.push(payload);
        return { data: { id: "mock" }, error: null };
      },
    },
  }),
}));

vi.mock("@/lib/matching/score", () => ({
  computeMatchScore: (_resume: unknown, _skills: unknown, _seniority: unknown) => ({
    // The real signature scores one resume against one job; this fake needs
    // to know WHICH job it was called for. Tests below route through a
    // single new posting at a time for exactly this reason — see each
    // describe block's own fixture.
    score: scoreByJob.get("current") ?? 0,
    explanation: { matchedSkills: [], missingSkills: [], seniorityMatch: true },
  }),
}));

const fixtures = vi.hoisted(() => ({
  newPostings: [] as unknown[],
  organizations: [] as unknown[],
  recipients: [] as unknown[],
  baseResumeUserIds: [] as unknown[],
  activity: [] as unknown[],
  lastAlerts: [] as unknown[],
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      let rows: Record<string, unknown>[] = [];
      switch (table) {
        case "job_postings":
          rows = fixtures.newPostings as Record<string, unknown>[];
          break;
        case "organizations":
          rows = fixtures.organizations as Record<string, unknown>[];
          break;
        case "email_preferences":
          rows = fixtures.recipients as Record<string, unknown>[];
          break;
        case "resumes":
          rows = fixtures.baseResumeUserIds as Record<string, unknown>[];
          break;
        case "match_scores":
          rows = fixtures.activity as Record<string, unknown>[];
          break;
        case "proactive_match_alerts":
          rows = fixtures.lastAlerts as Record<string, unknown>[];
          break;
        default:
          rows = [];
      }

      let single = false;
      let isInsert = false;
      let insertPayload: Record<string, unknown> | null = null;

      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r) => r[col] === val);
          return chain;
        },
        in: (col: string, vals: unknown[]) => {
          rows = rows.filter((r) => vals.includes(r[col]));
          return chain;
        },
        gte: () => chain, // every fixture row is already "new enough" for these tests
        limit: () => chain,
        maybeSingle: () => {
          single = true;
          return chain;
        },
        insert: (payload: Record<string, unknown>) => {
          isInsert = true;
          insertPayload = payload;
          return chain;
        },
      };

      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => {
        if (isInsert) {
          if (table === "proactive_match_alerts") {
            const key = `${insertPayload!.user_id}:${insertPayload!.job_posting_id}`;
            if (preLockedPairs.has(key)) {
              return Promise.resolve({ error: { code: "23505", message: "duplicate key" } }).then(resolve);
            }
            insertedAlertLocks.push(insertPayload as { user_id: string; job_posting_id: string });
            return Promise.resolve({ error: null }).then(resolve);
          }
          if (table === "user_notifications") {
            insertedNotifications.push(insertPayload as { user_id: string; title: string });
          }
          return Promise.resolve({ error: null }).then(resolve);
        }
        if (single) return Promise.resolve({ data: rows[0] ?? null, error: null }).then(resolve);
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      };
      return chain;
    },
  }),
}));

import { sendProactiveMatchAlerts } from "@/lib/notifications/proactive-match-alert/send";

const SINCE = "2026-09-10T00:00:00.000Z";
const NOW = new Date("2026-09-10T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

const ONE_NEW_POSTING = [
  {
    id: "job-excellent",
    title: "Senior Backend Engineer",
    company_name: "Verified Co",
    location: "Lagos",
    posted_at: "2026-09-10T08:00:00.000Z",
    status: "open",
    organization_id: null, // external — nothing to verify, keeps the fixture simple
    unlisted_at: null,
    structured_jd: { skills: [] },
    seniority: null,
  },
];

beforeEach(() => {
  sentEmails.length = 0;
  insertedNotifications.length = 0;
  insertedAlertLocks.length = 0;
  scoreByJob.clear();
  scoreByJob.set("current", 90); // Excellent, by default — overridden per test
  preLockedPairs.clear();
  fixtures.newPostings = ONE_NEW_POSTING;
  fixtures.organizations = [];
  fixtures.recipients = [];
  fixtures.baseResumeUserIds = [];
  fixtures.activity = [];
  fixtures.lastAlerts = [];
});

function recipient(userId: string, over: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    unsubscribe_token: `tok-${userId}`,
    proactive_match_alert: true,
    profiles: { email: `${userId}@example.test`, first_name: "Ada" },
    ...over,
  };
}

describe("FAIL-BEFORE / PASS-AFTER: a not-actively-searching user with an Excellent match", () => {
  it("gets no alert if the pipeline is disabled for them (no base resume) — sanity control", async () => {
    fixtures.recipients = [recipient("no-resume-user")];
    fixtures.baseResumeUserIds = []; // no base resume on file
    const summary = await sendProactiveMatchAlerts(SINCE, NOW);
    expect(summary.sent).toBe(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("PASS-AFTER: a genuinely inactive user with an Excellent match gets a real alert today", async () => {
    fixtures.recipients = [recipient("inactive-user")];
    fixtures.baseResumeUserIds = [{ user_id: "inactive-user", structured_content: {}, is_base: true }];
    fixtures.activity = []; // no match_scores rows at all -> not actively searching
    scoreByJob.set("current", 90);

    const summary = await sendProactiveMatchAlerts(SINCE, NOW);

    expect(summary.sent).toBe(1);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe("inactive-user@example.test");
    expect(insertedNotifications).toHaveLength(1);
    expect(insertedNotifications[0].user_id).toBe("inactive-user");
    expect(insertedAlertLocks).toEqual([{ user_id: "inactive-user", job_posting_id: "job-excellent", score: 90 }]);
  });

  it("FAIL-BEFORE control: the SAME user does NOT get an alert once recent activity marks them actively searching", async () => {
    fixtures.recipients = [recipient("active-user")];
    fixtures.baseResumeUserIds = [{ user_id: "active-user", structured_content: {}, is_base: true }];
    fixtures.activity = [{ user_id: "active-user", computed_at: daysAgo(1) }]; // visited yesterday
    scoreByJob.set("current", 90); // same Excellent match as the passing case above

    const summary = await sendProactiveMatchAlerts(SINCE, NOW);

    expect(summary.sent).toBe(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("does not alert when the match is only Good, not Excellent", async () => {
    fixtures.recipients = [recipient("inactive-user-2")];
    fixtures.baseResumeUserIds = [{ user_id: "inactive-user-2" }];
    fixtures.activity = [];
    scoreByJob.set("current", 74); // Good, not Excellent

    const summary = await sendProactiveMatchAlerts(SINCE, NOW);
    expect(summary.sent).toBe(0);
  });
});

describe("per-user preference gate", () => {
  it("never even becomes a candidate once opted out", async () => {
    fixtures.recipients = []; // the query itself filters .eq("proactive_match_alert", true) —
    // an opted-out user's row would never come back, modelled here by
    // simply not being present in what the fixture returns.
    fixtures.baseResumeUserIds = [{ user_id: "opted-out-user", structured_content: {}, is_base: true }];
    fixtures.activity = [];
    const summary = await sendProactiveMatchAlerts(SINCE, NOW);
    expect(summary.sent).toBe(0);
    expect(summary.consideredCandidates).toBe(0);
  });
});

describe("rate limiting — a second Excellent match inside the interval", () => {
  it("does not double-alert a user already alerted 2 days ago (inside the 7-day window)", async () => {
    fixtures.recipients = [recipient("recently-alerted-user")];
    fixtures.baseResumeUserIds = [{ user_id: "recently-alerted-user", structured_content: {}, is_base: true }];
    fixtures.activity = [];
    fixtures.lastAlerts = [{ user_id: "recently-alerted-user", sent_at: daysAgo(2) }];
    scoreByJob.set("current", 95); // a real, second Excellent match arriving inside the window

    const summary = await sendProactiveMatchAlerts(SINCE, NOW);

    expect(summary.sent, "rate limit did not suppress a second alert inside the interval").toBe(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("alerts again once the rate-limit window has fully elapsed", async () => {
    fixtures.recipients = [recipient("cooled-down-user")];
    fixtures.baseResumeUserIds = [{ user_id: "cooled-down-user", structured_content: {}, is_base: true }];
    fixtures.activity = [];
    fixtures.lastAlerts = [{ user_id: "cooled-down-user", sent_at: daysAgo(8) }];
    scoreByJob.set("current", 90);

    const summary = await sendProactiveMatchAlerts(SINCE, NOW);
    expect(summary.sent).toBe(1);
  });
});

describe("the send-once lock — a duplicate (user, job) pair is refused, not double-sent", () => {
  it("skips sending when the lock insert reports a unique-constraint conflict", async () => {
    fixtures.recipients = [recipient("racing-user")];
    fixtures.baseResumeUserIds = [{ user_id: "racing-user", structured_content: {}, is_base: true }];
    fixtures.activity = [];
    scoreByJob.set("current", 92);
    preLockedPairs.add("racing-user:job-excellent"); // simulates a concurrent run that already claimed this pair

    const summary = await sendProactiveMatchAlerts(SINCE, NOW);

    expect(summary.sent).toBe(0);
    expect(sentEmails).toHaveLength(0);
    expect(summary.failed, "a lost race is a no-op, not a failure").toBe(0);
  });
});
