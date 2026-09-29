/**
 * send-467's win-back email, driven end to end through `sendWinbackEmails`
 * with a mocked service-role client — matching this project's standing
 * pattern for the digest (verification-gate.test.ts) and the proactive alert
 * (proactive-match-alert-eligibility.test.ts): the assertion is against the
 * ACTUAL query wiring and eligibility logic, not just the pure helpers in
 * select.ts, while still touching nothing real (no database, no mailer).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentEmails = vi.hoisted(() => [] as { to: string; subject: string }[]);
const stampedUpdates = vi.hoisted(() => [] as { user_id: string; win_back_last_sent_at: string }[]);

vi.mock("@/lib/flags/read", () => ({ isFeatureEnabled: vi.fn(async () => true) }));

vi.mock("@/lib/resend/client", () => ({
  getResendClient: () => ({
    emails: {
      send: async (payload: { to: string; subject: string }) => {
        sentEmails.push(payload);
        return { data: { id: "mock" }, error: null };
      },
    },
  }),
}));

const fixtures = vi.hoisted(() => ({
  recipients: [] as unknown[],
  baseResumeUserIds: [] as unknown[],
  matchScores: [] as unknown[],
  organizations: [] as unknown[],
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      let rows: Record<string, unknown>[] = [];
      switch (table) {
        case "email_preferences":
          rows = fixtures.recipients as Record<string, unknown>[];
          break;
        case "resumes":
          rows = fixtures.baseResumeUserIds as Record<string, unknown>[];
          break;
        case "match_scores":
          rows = fixtures.matchScores as Record<string, unknown>[];
          break;
        case "organizations":
          rows = fixtures.organizations as Record<string, unknown>[];
          break;
        default:
          rows = [];
      }

      let isUpdate = false;
      let updatePayload: Record<string, unknown> | null = null;
      let updateEqUserId: string | null = null;

      // send.ts's match_scores query filters on joined-table columns like
      // "job_postings.status" — real PostgREST resolves that dotted path
      // against the joined object; this mock has to do the same or every
      // row is silently filtered out regardless of its actual content.
      const resolve_ = (row: Record<string, unknown>, col: string): unknown => {
        if (!col.includes(".")) return row[col];
        const [table, field] = col.split(".");
        const joined = row[table] as Record<string, unknown> | undefined;
        return joined?.[field];
      };

      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          if (isUpdate && col === "user_id") updateEqUserId = val as string;
          rows = rows.filter((r) => resolve_(r, col) === val);
          return chain;
        },
        in: (col: string, vals: unknown[]) => {
          rows = rows.filter((r) => vals.includes(resolve_(r, col)));
          return chain;
        },
        gte: (col: string, val: unknown) => {
          rows = rows.filter(
            (r) => (resolve_(r, col) as string | number) >= (val as string | number),
          );
          return chain;
        },
        limit: () => chain,
        update: (payload: Record<string, unknown>) => {
          isUpdate = true;
          updatePayload = payload;
          return chain;
        },
      };

      (chain as { then: unknown }).then = (resolve: (v: unknown) => void) => {
        if (isUpdate) {
          if (table === "email_preferences") {
            stampedUpdates.push({
              user_id: updateEqUserId!,
              ...(updatePayload as { win_back_last_sent_at: string }),
            });
          }
          return Promise.resolve({ error: null }).then(resolve);
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      };
      return chain;
    },
  }),
}));

import { sendWinbackEmails } from "@/lib/notifications/win-back/send";

const NOW = new Date("2026-09-26T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function recipient(userId: string, over: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    unsubscribe_token: `tok-${userId}`,
    win_back_email: true,
    win_back_last_sent_at: null,
    profiles: { email: `${userId}@example.test`, first_name: "Ada", last_active_at: daysAgo(16) },
    ...over,
  };
}

function matchScoreRow(userId: string, jobId: string, score: number, over: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    score,
    explanation: { matchedSkills: ["sql"], missingSkills: [], seniorityAlignment: "unknown" },
    job_posting_id: jobId,
    job_postings: {
      id: jobId,
      title: `Job ${jobId}`,
      company_name: "Verified Co",
      location: "Lagos",
      posted_at: daysAgo(5),
      status: "open",
      organization_id: null, // external — nothing to verify
      unlisted_at: null,
    },
    ...over,
  };
}

beforeEach(() => {
  sentEmails.length = 0;
  stampedUpdates.length = 0;
  fixtures.recipients = [];
  fixtures.baseResumeUserIds = [];
  fixtures.matchScores = [];
  fixtures.organizations = [];
});

describe("the calendar window — a dormant user with a fresh Good/Excellent match", () => {
  it("sends when inside the 14-21 day window with a matching posting", async () => {
    fixtures.recipients = [recipient("dormant-user")];
    fixtures.baseResumeUserIds = [{ user_id: "dormant-user", is_base: true }];
    fixtures.matchScores = [matchScoreRow("dormant-user", "job-1", 82)];

    const summary = await sendWinbackEmails(NOW);

    expect(summary.sent).toBe(1);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe("dormant-user@example.test");
    expect(stampedUpdates).toHaveLength(1);
    expect(stampedUpdates[0].user_id).toBe("dormant-user");
  });

  it("does not send to a user active only 5 days ago (not dormant yet)", async () => {
    fixtures.recipients = [
      recipient("recently-active-user", { profiles: { email: "recently-active-user@example.test", first_name: "Ada", last_active_at: daysAgo(5) } }),
    ];
    fixtures.baseResumeUserIds = [{ user_id: "recently-active-user", is_base: true }];
    fixtures.matchScores = [matchScoreRow("recently-active-user", "job-1", 82)];

    const summary = await sendWinbackEmails(NOW);
    expect(summary.sent).toBe(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("does not send to a user gone 30 days (past the one-episode window)", async () => {
    fixtures.recipients = [
      recipient("long-gone-user", { profiles: { email: "long-gone-user@example.test", first_name: "Ada", last_active_at: daysAgo(30) } }),
    ];
    fixtures.baseResumeUserIds = [{ user_id: "long-gone-user", is_base: true }];
    fixtures.matchScores = [matchScoreRow("long-gone-user", "job-1", 82)];

    const summary = await sendWinbackEmails(NOW);
    expect(summary.sent).toBe(0);
  });

  it("skips silently (no send, no stamp) when there is nothing new to report", async () => {
    fixtures.recipients = [recipient("nothing-new-user")];
    fixtures.baseResumeUserIds = [{ user_id: "nothing-new-user", is_base: true }];
    fixtures.matchScores = []; // no matching postings at all

    const summary = await sendWinbackEmails(NOW);
    expect(summary.sent).toBe(0);
    expect(summary.skippedNoPostings).toBe(1);
    expect(stampedUpdates).toHaveLength(0);
  });

  it("does not count a Fair match (below the Good/Excellent floor)", async () => {
    fixtures.recipients = [recipient("fair-only-user")];
    fixtures.baseResumeUserIds = [{ user_id: "fair-only-user", is_base: true }];
    fixtures.matchScores = [matchScoreRow("fair-only-user", "job-1", 65)]; // below MIN_DIGEST_SCORE (70)

    const summary = await sendWinbackEmails(NOW);
    expect(summary.sent).toBe(0);
    expect(summary.skippedNoPostings).toBe(1);
  });

  it("excludes an unverified organisation's posting the same way the digest does", async () => {
    fixtures.recipients = [recipient("unverified-org-user")];
    fixtures.baseResumeUserIds = [{ user_id: "unverified-org-user", is_base: true }];
    fixtures.matchScores = [
      matchScoreRow("unverified-org-user", "job-1", 90, {
        job_postings: {
          id: "job-1",
          title: "Job job-1",
          company_name: "Sketchy Co",
          location: "Lagos",
          posted_at: daysAgo(5),
          status: "open",
          organization_id: "org-unverified",
          unlisted_at: null,
        },
      }),
    ];
    fixtures.organizations = []; // org-unverified never appears as verified

    const summary = await sendWinbackEmails(NOW);
    expect(summary.sent, "an unverified org's posting must not be surfaced").toBe(0);
  });
});

describe("no base resume — nothing to score against", () => {
  it("never becomes an eligible candidate", async () => {
    fixtures.recipients = [recipient("no-resume-user")];
    fixtures.baseResumeUserIds = []; // no base resume on file
    fixtures.matchScores = [matchScoreRow("no-resume-user", "job-1", 90)];

    const summary = await sendWinbackEmails(NOW);
    expect(summary.sent).toBe(0);
    expect(summary.consideredCandidates).toBe(0);
  });
});

describe("per-user preference and dedup gates", () => {
  it("never becomes a candidate once opted out (query itself filters win_back_email = true)", async () => {
    fixtures.recipients = []; // an opted-out user's row would never come back from the real query
    fixtures.baseResumeUserIds = [{ user_id: "opted-out-user", is_base: true }];
    const summary = await sendWinbackEmails(NOW);
    expect(summary.sent).toBe(0);
    expect(summary.consideredCandidates).toBe(0);
  });

  it("does not re-send inside the same dormancy episode (already sent since last_active_at)", async () => {
    fixtures.recipients = [
      recipient("already-sent-user", {
        win_back_last_sent_at: daysAgo(1), // sent yesterday
        profiles: { email: "already-sent-user@example.test", first_name: "Ada", last_active_at: daysAgo(16) }, // dormant since 16 days ago — the send 1 day ago is AFTER that, so already covered
      }),
    ];
    fixtures.baseResumeUserIds = [{ user_id: "already-sent-user", is_base: true }];
    fixtures.matchScores = [matchScoreRow("already-sent-user", "job-1", 90)];

    const summary = await sendWinbackEmails(NOW);
    expect(summary.sent, "a second win-back email in the same episode must not go out").toBe(0);
  });

  it("DOES send again once a new episode has started (active again since the last send)", async () => {
    fixtures.recipients = [
      recipient("new-episode-user", {
        win_back_last_sent_at: daysAgo(40), // an old win-back email, from a past episode
        profiles: { email: "new-episode-user@example.test", first_name: "Ada", last_active_at: daysAgo(16) }, // active again since then, now dormant a second time
      }),
    ];
    fixtures.baseResumeUserIds = [{ user_id: "new-episode-user", is_base: true }];
    fixtures.matchScores = [matchScoreRow("new-episode-user", "job-1", 90)];

    const summary = await sendWinbackEmails(NOW);
    expect(summary.sent, "a NEW dormancy episode must be eligible for its own win-back email").toBe(1);
  });
});

describe("the three switches", () => {
  it("does nothing when the feature flag is off", async () => {
    const flags = await import("@/lib/flags/read");
    vi.mocked(flags.isFeatureEnabled).mockResolvedValueOnce(false);
    fixtures.recipients = [recipient("someone")];
    fixtures.baseResumeUserIds = [{ user_id: "someone", is_base: true }];
    fixtures.matchScores = [matchScoreRow("someone", "job-1", 90)];

    const summary = await sendWinbackEmails(NOW);
    expect(summary.enabled).toBe(false);
    expect(summary.sent).toBe(0);
    expect(sentEmails).toHaveLength(0);
  });
});
