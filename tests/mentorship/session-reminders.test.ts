/**
 * runMentorshipSessionReminders (src/lib/mentorship/notifications.ts) — the
 * daily reminder sweep. Runs for real against the live database, same shape
 * as no-show-sweep.test.ts; only Resend is mocked.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Session-reminders test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const sentEmails = vi.hoisted(() => [] as Array<{ to: string; subject: string }>);

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

let mentorId: string;
let menteeId: string;
const sessionIds: string[] = [];
const slotIds: string[] = [];

beforeAll(async () => {
  const mentor = await createTestUser("reminder-mentor");
  const mentee = await createTestUser("reminder-mentee");
  mentorId = mentor.id;
  menteeId = mentee.id;
  const { error } = await admin.from("mentor_profiles").insert({ user_id: mentorId, status: "approved", base_price_ngn: 15_000 });
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await admin.from("mentor_profiles").delete().eq("user_id", mentorId);
  await deleteTestUsers([mentorId, menteeId]);
}, 60_000);

afterEach(async () => {
  sentEmails.length = 0;
  if (sessionIds.length) await admin.from("mentorship_sessions").delete().in("id", sessionIds);
  if (slotIds.length) await admin.from("mentor_availability_slots").delete().in("id", slotIds);
  await admin.from("user_notifications").delete().eq("type", "mentorship_session_reminder").in("user_id", [mentorId, menteeId]);
  sessionIds.length = 0;
  slotIds.length = 0;
});

/** A CONFIRMED session starting `hoursFromNow` from now, with `reminder_sent_at` as given. */
async function makeConfirmedSession(hoursFromNow: number, reminderSentAt: string | null = null): Promise<string> {
  const start = new Date(Date.now() + hoursFromNow * 3600_000).toISOString();
  const end = new Date(Date.now() + (hoursFromNow + 1) * 3600_000).toISOString();
  const { data: slot, error: slotError } = await admin
    .from("mentor_availability_slots")
    .insert({ mentor_id: mentorId, start_at: start, end_at: end, is_booked: true })
    .select("id")
    .single();
  if (slotError || !slot) throw slotError ?? new Error("no slot");
  slotIds.push(slot.id);

  const { data: session, error } = await admin
    .from("mentorship_sessions")
    .insert({
      mentor_id: mentorId,
      mentee_id: menteeId,
      availability_slot_id: slot.id,
      session_type: "mock_interview",
      scheduled_start: start,
      scheduled_end: end,
      price_ngn: 18_750,
      platform_commission_ngn: 2_813,
      mentor_payout_ngn: 15_937,
      status: "confirmed",
      meeting_link: "https://meet.jit.si/talentrah-test-room",
      mentor_confirmed_at: new Date().toISOString(),
      reminder_sent_at: reminderSentAt,
    })
    .select("id")
    .single();
  if (error || !session) throw error ?? new Error("no session");
  sessionIds.push(session.id);
  return session.id;
}

describe("runMentorshipSessionReminders", () => {
  it("reminds a session starting inside the 24h window, and marks it reminded", async () => {
    const sessionId = await makeConfirmedSession(2);

    const { runMentorshipSessionReminders } = await import("@/lib/mentorship/notifications");
    const summary = await runMentorshipSessionReminders();

    expect(summary.ok).toBe(true);
    expect(summary.sent).toBeGreaterThanOrEqual(1);
    expect(sentEmails.length).toBeGreaterThanOrEqual(2); // mentor + mentee

    const { data } = await admin.from("mentorship_sessions").select("reminder_sent_at").eq("id", sessionId).single();
    expect(data?.reminder_sent_at, "the sweep ran but never set reminder_sent_at").not.toBeNull();
  });

  it("leaves a session outside the 24h window untouched", async () => {
    const sessionId = await makeConfirmedSession(72); // 3 days out

    const { runMentorshipSessionReminders } = await import("@/lib/mentorship/notifications");
    await runMentorshipSessionReminders();

    expect(sentEmails).toHaveLength(0);
    const { data } = await admin.from("mentorship_sessions").select("reminder_sent_at").eq("id", sessionId).single();
    expect(data?.reminder_sent_at).toBeNull();
  });

  it("never re-reminds a session already marked reminder_sent_at", async () => {
    await makeConfirmedSession(2, new Date().toISOString());

    const { runMentorshipSessionReminders } = await import("@/lib/mentorship/notifications");
    const summary = await runMentorshipSessionReminders();

    expect(summary.considered).toBe(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("ignores a session that is not yet confirmed, even inside the window", async () => {
    const start = new Date(Date.now() + 2 * 3600_000).toISOString();
    const end = new Date(Date.now() + 3 * 3600_000).toISOString();
    const { data: slot } = await admin
      .from("mentor_availability_slots")
      .insert({ mentor_id: mentorId, start_at: start, end_at: end, is_booked: true })
      .select("id")
      .single();
    slotIds.push(slot!.id);
    const { data: session } = await admin
      .from("mentorship_sessions")
      .insert({
        mentor_id: mentorId,
        mentee_id: menteeId,
        availability_slot_id: slot!.id,
        session_type: "resume_review",
        scheduled_start: start,
        scheduled_end: end,
        price_ngn: 15_000,
        platform_commission_ngn: 2_250,
        mentor_payout_ngn: 12_750,
        status: "awaiting_confirmation",
      })
      .select("id")
      .single();
    sessionIds.push(session!.id);

    const { runMentorshipSessionReminders } = await import("@/lib/mentorship/notifications");
    const summary = await runMentorshipSessionReminders();

    expect(summary.considered).toBe(0);
    expect(sentEmails).toHaveLength(0);
  });

  it("running the sweep TWICE never double-sends the same session's reminder", async () => {
    await makeConfirmedSession(2);

    const { runMentorshipSessionReminders } = await import("@/lib/mentorship/notifications");
    await runMentorshipSessionReminders();
    const firstRunCount = sentEmails.length;
    await runMentorshipSessionReminders();

    expect(sentEmails.length, "a second run sent additional emails for an already-reminded session").toBe(firstRunCount);
  });

  it("writes in-app reminder notifications for both parties", async () => {
    await makeConfirmedSession(2);

    const { runMentorshipSessionReminders } = await import("@/lib/mentorship/notifications");
    await runMentorshipSessionReminders();

    const { data } = await admin
      .from("user_notifications")
      .select("user_id")
      .eq("type", "mentorship_session_reminder")
      .in("user_id", [mentorId, menteeId]);
    expect(data).toHaveLength(2);
  });
});
