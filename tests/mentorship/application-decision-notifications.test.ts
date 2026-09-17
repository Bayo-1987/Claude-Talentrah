/**
 * notifyMentorApplicationDecision (src/lib/mentorship/notifications.ts) —
 * closes the gap decideMentorApplicationAction left: before this, the RPC
 * flipped mentor_profiles.status and wrote only an audit-log row, so an
 * applicant learned the outcome only by revisiting /mentorship/apply
 * themselves. Same shape and same guarantee as notifySessionConfirmed's own
 * suite (tests/mentorship/confirmation-notifications.test.ts): runs for real
 * against the live database, only Resend is mocked, a guaranteed
 * user_notifications row plus a best-effort email, and a thrown/rejected
 * email send never propagates back to the caller.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Application-decision-notifications test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const sentEmails = vi.hoisted(() => [] as Array<{ to: string; subject: string }>);
const resendConfigured = vi.hoisted(() => ({ value: true }));
const sendShouldThrow = vi.hoisted(() => ({ value: false }));

vi.mock("@/lib/resend/client", () => ({
  getResendClient: () =>
    resendConfigured.value
      ? {
          emails: {
            send: async (payload: { to: string; subject: string }) => {
              if (sendShouldThrow.value) throw new Error("Resend is down");
              sentEmails.push(payload);
              return { data: { id: "mock" }, error: null };
            },
          },
        }
      : null,
}));

let applicantId: string;
let applicantEmail: string;

beforeAll(async () => {
  const applicant = await createTestUser("decision-notify-applicant");
  applicantId = applicant.id;
  applicantEmail = applicant.email;
  await admin.from("profiles").update({ first_name: "Ada", last_name: "Applicant" }).eq("id", applicantId);
}, 60_000);

afterAll(async () => {
  await deleteTestUsers([applicantId]);
}, 60_000);

afterEach(async () => {
  sentEmails.length = 0;
  resendConfigured.value = true;
  sendShouldThrow.value = false;
  await admin.from("user_notifications").delete().eq("type", "mentor_application_decision").eq("user_id", applicantId);
});

describe("notifyMentorApplicationDecision", () => {
  it("approved: writes an in-app notification and emails the applicant", async () => {
    const { notifyMentorApplicationDecision } = await import("@/lib/mentorship/notifications");
    await notifyMentorApplicationDecision(applicantId, "approved", null);

    const { data } = await admin
      .from("user_notifications")
      .select("user_id, type, link, title")
      .eq("type", "mentor_application_decision")
      .eq("user_id", applicantId);
    expect(data).toHaveLength(1);
    expect(data?.[0]?.link).toBe("/mentorship/apply");

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(applicantEmail);
  });

  it("rejected: the in-app notification and email both include the reviewer's note", async () => {
    const { notifyMentorApplicationDecision } = await import("@/lib/mentorship/notifications");
    await notifyMentorApplicationDecision(applicantId, "rejected", "Add more detail on your mentoring experience.");

    const { data } = await admin
      .from("user_notifications")
      .select("body")
      .eq("type", "mentor_application_decision")
      .eq("user_id", applicantId)
      .single();
    expect(data?.body).toContain("Add more detail on your mentoring experience.");

    expect(sentEmails).toHaveLength(1);
  });

  it("still writes the in-app notification when RESEND_API_KEY is not configured", async () => {
    resendConfigured.value = false;
    const { notifyMentorApplicationDecision } = await import("@/lib/mentorship/notifications");
    await notifyMentorApplicationDecision(applicantId, "approved", null);

    expect(sentEmails).toHaveLength(0);
    const { data } = await admin
      .from("user_notifications")
      .select("user_id")
      .eq("type", "mentor_application_decision")
      .eq("user_id", applicantId);
    expect(data).toHaveLength(1);
  });

  it("a thrown email send never propagates back to the caller — the in-app row still landed", async () => {
    sendShouldThrow.value = true;
    const { notifyMentorApplicationDecision } = await import("@/lib/mentorship/notifications");
    await expect(notifyMentorApplicationDecision(applicantId, "approved", null)).resolves.toBeUndefined();

    expect(sentEmails).toHaveLength(0);
    const { data } = await admin
      .from("user_notifications")
      .select("user_id")
      .eq("type", "mentor_application_decision")
      .eq("user_id", applicantId);
    expect(data).toHaveLength(1);
  });

  it("is a safe no-op that never throws for a userId with no profile/email on file", async () => {
    const { notifyMentorApplicationDecision } = await import("@/lib/mentorship/notifications");
    await expect(
      notifyMentorApplicationDecision("00000000-0000-0000-0000-000000000000", "approved", null),
    ).resolves.toBeUndefined();
    expect(sentEmails).toHaveLength(0);
  });
});
