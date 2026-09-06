/**
 * sendVerificationReminders — orchestration around the pure due.ts rule.
 *
 * NOTHING HERE TOUCHES A REAL MAILER. Same standing rule as the digest's own
 * test suite (tests/digest/flag-gate.test.ts): Resend and the database
 * client are both mocked, so no run of this suite can accidentally reach a
 * real inbox.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sentEmails = vi.hoisted(() => [] as { to: string; subject: string }[]);
const updates = vi.hoisted(() => [] as { table: string; payload: unknown; id: string }[]);
const state = vi.hoisted(() => ({
  mailerConfigured: true,
  organizations: [] as Array<{
    id: string;
    name: string;
    created_by: string;
    verification_reminder_48h_sent_at: string | null;
    verification_reminder_7d_sent_at: string | null;
  }>,
  postings: [] as Array<{ organization_id: string; posted_at: string }>,
  profiles: [] as Array<{ id: string; email: string; first_name: string | null }>,
}));

vi.mock("@/lib/resend/client", () => ({
  getResendClient: () =>
    state.mailerConfigured
      ? {
          emails: {
            send: async (payload: { to: string; subject: string }) => {
              sentEmails.push({ to: payload.to, subject: payload.subject });
              return { data: { id: "mock" }, error: null };
            },
          },
        }
      : null,
}));

vi.mock("@/lib/seo/site", () => ({
  absoluteUrl: (path: string) => `https://talentrah.test${path}`,
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        limit: () => builder,
        update: (payload: unknown) => ({
          eq: async (_col: string, id: string) => {
            updates.push({ table, payload, id });
            return { error: null };
          },
        }),
        then: (resolve: (v: { data: unknown; error: null }) => void) => {
          if (table === "organizations") return resolve({ data: state.organizations, error: null });
          if (table === "job_postings") return resolve({ data: state.postings, error: null });
          if (table === "profiles") return resolve({ data: state.profiles, error: null });
          return resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  }),
}));

import { sendVerificationReminders } from "@/lib/employer-verification-reminders/send";

const NOW = new Date("2026-09-10T00:00:00.000Z"); // well past 7 days from the fixture posting below

beforeEach(() => {
  sentEmails.length = 0;
  updates.length = 0;
  state.mailerConfigured = true;
  state.organizations = [];
  state.postings = [];
  state.profiles = [];
});

describe("mailer not configured", () => {
  it("sends nothing and says why", async () => {
    state.mailerConfigured = false;
    const summary = await sendVerificationReminders(NOW);
    expect(sentEmails).toHaveLength(0);
    expect(summary.reason).toMatch(/mailer/i);
  });
});

describe("no unverified organizations", () => {
  it("sends nothing", async () => {
    const summary = await sendVerificationReminders(NOW);
    expect(sentEmails).toHaveLength(0);
    expect(summary.considered).toBe(0);
  });
});

describe("an org with no job posted at all", () => {
  it("is never a candidate, even though it's unverified", async () => {
    state.organizations = [
      {
        id: "org-empty",
        name: "Empty Co",
        created_by: "user-1",
        verification_reminder_48h_sent_at: null,
        verification_reminder_7d_sent_at: null,
      },
    ];
    // No matching row in state.postings for org-empty.
    const summary = await sendVerificationReminders(NOW);
    expect(sentEmails).toHaveLength(0);
    expect(summary.considered).toBe(0);
  });
});

describe("an org due for the 48h reminder", () => {
  it("sends it and stamps the 48h column, not the 7d one", async () => {
    state.organizations = [
      {
        id: "org-48h",
        name: "Fresh Co",
        created_by: "user-1",
        verification_reminder_48h_sent_at: null,
        verification_reminder_7d_sent_at: null,
      },
    ];
    state.postings = [{ organization_id: "org-48h", posted_at: "2026-09-07T12:00:00.000Z" }]; // 60h before NOW — past 48h, short of 7d
    state.profiles = [{ id: "user-1", email: "ada@fresh.example", first_name: "Ada" }];

    const summary = await sendVerificationReminders(NOW);
    expect(summary.sent48h).toBe(1);
    expect(summary.sent7d).toBe(0);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe("ada@fresh.example");

    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("organizations");
    expect(updates[0].payload).toHaveProperty("verification_reminder_48h_sent_at");
    expect(updates[0].payload).not.toHaveProperty("verification_reminder_7d_sent_at");
  });
});

describe("an org already reminded at 48h, not yet due for 7d", () => {
  it("sends nothing", async () => {
    state.organizations = [
      {
        id: "org-mid",
        name: "Mid Co",
        created_by: "user-1",
        verification_reminder_48h_sent_at: "2026-09-07T12:00:00.000Z",
        verification_reminder_7d_sent_at: null,
      },
    ];
    state.postings = [{ organization_id: "org-mid", posted_at: "2026-09-05T00:00:00.000Z" }]; // 5 days before NOW
    state.profiles = [{ id: "user-1", email: "b@mid.example", first_name: null }];

    const summary = await sendVerificationReminders(NOW);
    expect(sentEmails).toHaveLength(0);
    expect(summary.considered).toBe(0);
  });
});

describe("an org that's had both reminders already", () => {
  it("never sends a third, no matter how long it's been", async () => {
    state.organizations = [
      {
        id: "org-done",
        name: "Done Co",
        created_by: "user-1",
        verification_reminder_48h_sent_at: "2026-01-03T00:00:00.000Z",
        verification_reminder_7d_sent_at: "2026-01-08T00:00:00.000Z",
      },
    ];
    state.postings = [{ organization_id: "org-done", posted_at: "2026-01-01T00:00:00.000Z" }];
    state.profiles = [{ id: "user-1", email: "c@done.example", first_name: null }];

    const summary = await sendVerificationReminders(NOW);
    expect(sentEmails).toHaveLength(0);
    expect(summary.considered).toBe(0);
  });
});

describe("a creator with no email on file", () => {
  it("counts as failed rather than throwing or silently skipping", async () => {
    state.organizations = [
      {
        id: "org-noemail",
        name: "No Email Co",
        created_by: "user-ghost",
        verification_reminder_48h_sent_at: null,
        verification_reminder_7d_sent_at: null,
      },
    ];
    state.postings = [{ organization_id: "org-noemail", posted_at: "2026-09-01T00:00:00.000Z" }];
    state.profiles = []; // no matching profile row

    const summary = await sendVerificationReminders(NOW);
    expect(sentEmails).toHaveLength(0);
    expect(summary.failed).toBe(1);
  });
});
