/**
 * sendHiredMomentEmail (src/lib/notifications/hired-moment/send.ts) —
 * best-effort behaviour and the job-title/company lookup, on both the
 * real-posting and manual-tracker-entry paths.
 *
 * Nothing here touches a real mailer or a real database — both are mocked,
 * matching this project's standing rule that a notification pipeline is
 * never self-tested against a real user (see
 * tests/notifications/proactive-match-alert-gates.test.ts's own header).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface ApplicationRow {
  job_posting_id: string | null;
  manual_job_snapshot: unknown;
  job_postings: { title: string; company_name: string } | null;
}
interface ProfileRow {
  email: string | null;
  first_name: string | null;
  referral_code: string | null;
}

const tableResults = vi.hoisted(() => ({
  applications: { data: null as ApplicationRow | null, error: null as { message: string } | null },
  profiles: { data: null as ProfileRow | null, error: null as { message: string } | null },
}));

const sentEmails = vi.hoisted(() => [] as unknown[]);
const resendConfigured = vi.hoisted(() => ({ value: true, shouldThrow: false }));
const queriedTables = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: "applications" | "profiles") => {
      queriedTables.push(table);
      const result = tableResults[table];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => result,
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () =>
    resendConfigured.value
      ? {
          emails: {
            send: async (payload: unknown) => {
              if (resendConfigured.shouldThrow) throw new Error("Resend is down");
              sentEmails.push(payload);
              return { data: { id: "mock" }, error: null };
            },
          },
        }
      : null,
}));

vi.mock("@/lib/referrals/url", () => ({
  getReferralUrl: async (code: string) => `https://talentrah.com/signup?ref=${code}`,
}));

import { sendHiredMomentEmail } from "@/lib/notifications/hired-moment/send";

const USER_ID = "user-1";
const APPLICATION_ID = "app-1";

beforeEach(() => {
  sentEmails.length = 0;
  resendConfigured.value = true;
  resendConfigured.shouldThrow = false;
  tableResults.applications = { data: null, error: null };
  tableResults.profiles = { data: null, error: null };
});

describe("job-title/company resolution — both paths tracker entries can take", () => {
  it("resolves from a real job_postings row when job_posting_id is set", async () => {
    tableResults.applications = {
      data: {
        job_posting_id: "posting-1",
        manual_job_snapshot: null,
        job_postings: { title: "Senior Backend Engineer", company_name: "Verified Co" },
      },
      error: null,
    };
    tableResults.profiles = {
      data: { email: "ada@example.com", first_name: "Ada", referral_code: "ADA123" },
      error: null,
    };

    await sendHiredMomentEmail({ userId: USER_ID, applicationId: APPLICATION_ID });

    expect(sentEmails).toHaveLength(1);
    const email = sentEmails[0] as { subject: string; text: string; html: string; to: string };
    expect(email.to).toBe("ada@example.com");
    expect(email.subject).toContain("Senior Backend Engineer");
    expect(email.text).toContain("Verified Co");
  });

  it("resolves from manual_job_snapshot when there is no job_postings row (manual tracker entry)", async () => {
    tableResults.applications = {
      data: {
        job_posting_id: null,
        manual_job_snapshot: { companyName: "Invented Ltd", title: "Chief Nobody" },
        job_postings: null,
      },
      error: null,
    };
    tableResults.profiles = {
      data: { email: "bo@example.com", first_name: "Bo", referral_code: "BO456" },
      error: null,
    };

    await sendHiredMomentEmail({ userId: USER_ID, applicationId: APPLICATION_ID });

    expect(sentEmails).toHaveLength(1);
    const email = sentEmails[0] as { subject: string; text: string };
    expect(email.subject).toContain("Chief Nobody");
    expect(email.text).toContain("Invented Ltd");
  });

  it("sends nothing when neither a job_postings row nor a usable manual_job_snapshot is present", async () => {
    tableResults.applications = {
      data: { job_posting_id: null, manual_job_snapshot: null, job_postings: null },
      error: null,
    };
    tableResults.profiles = {
      data: { email: "ada@example.com", first_name: "Ada", referral_code: "ADA123" },
      error: null,
    };

    await sendHiredMomentEmail({ userId: USER_ID, applicationId: APPLICATION_ID });

    expect(sentEmails).toHaveLength(0);
  });
});

describe("best-effort — never throws, and degrades gracefully", () => {
  const fullApplication = {
    job_posting_id: "posting-1",
    manual_job_snapshot: null,
    job_postings: { title: "Engineer", company_name: "Acme" },
  };

  it("does nothing, without throwing, when the application row cannot be found", async () => {
    tableResults.applications = { data: null, error: null };

    await expect(sendHiredMomentEmail({ userId: USER_ID, applicationId: APPLICATION_ID })).resolves.toBeUndefined();
    expect(sentEmails).toHaveLength(0);
  });

  it("does nothing, without throwing, when the user has no email on file", async () => {
    tableResults.applications = { data: fullApplication, error: null };
    tableResults.profiles = { data: { email: null, first_name: "Ada", referral_code: "ADA123" }, error: null };

    await expect(sendHiredMomentEmail({ userId: USER_ID, applicationId: APPLICATION_ID })).resolves.toBeUndefined();
    expect(sentEmails).toHaveLength(0);
  });

  it("does nothing, without throwing, when RESEND_API_KEY is not configured", async () => {
    tableResults.applications = { data: fullApplication, error: null };
    tableResults.profiles = {
      data: { email: "ada@example.com", first_name: "Ada", referral_code: "ADA123" },
      error: null,
    };
    resendConfigured.value = false;

    await expect(sendHiredMomentEmail({ userId: USER_ID, applicationId: APPLICATION_ID })).resolves.toBeUndefined();
    expect(sentEmails).toHaveLength(0);
  });

  it("SABOTAGE-PROOF TARGET: a throwing Resend send never propagates out of sendHiredMomentEmail", async () => {
    tableResults.applications = { data: fullApplication, error: null };
    tableResults.profiles = {
      data: { email: "ada@example.com", first_name: "Ada", referral_code: "ADA123" },
      error: null,
    };
    resendConfigured.shouldThrow = true;

    await expect(sendHiredMomentEmail({ userId: USER_ID, applicationId: APPLICATION_ID })).resolves.toBeUndefined();
  });
});

describe("does not write a user_notifications row", () => {
  it("only ever queries applications and profiles — never user_notifications — matching this file's own header: HiredReferralBanner already covers the in-app surface", async () => {
    queriedTables.length = 0;
    tableResults.applications = {
      data: {
        job_posting_id: "posting-1",
        manual_job_snapshot: null,
        job_postings: { title: "Engineer", company_name: "Acme" },
      },
      error: null,
    };
    tableResults.profiles = {
      data: { email: "ada@example.com", first_name: "Ada", referral_code: "ADA123" },
      error: null,
    };

    await sendHiredMomentEmail({ userId: USER_ID, applicationId: APPLICATION_ID });

    expect(queriedTables).toEqual(["applications", "profiles"]);
    expect(queriedTables).not.toContain("user_notifications");
  });
});
