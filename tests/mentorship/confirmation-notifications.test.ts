/**
 * notifySessionConfirmed (src/lib/mentorship/notifications.ts) — the
 * confirmation-time calendar invite + email + in-app notification to BOTH
 * parties, closing the gap that confirmMentorSessionAction previously left:
 * mark_mentor_session_confirmed set meeting_link in the database and told no
 * one. Runs for real against the live database, same shape as
 * no-show-sweep.test.ts; only Resend is mocked, since there is no way to make
 * a real send controllable in a test.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Confirmation-notifications test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const sentEmails = vi.hoisted(() => [] as Array<{ to: string; subject: string; attachments?: Array<{ filename: string; content: unknown }> }>);
const resendConfigured = vi.hoisted(() => ({ value: true }));

vi.mock("@/lib/resend/client", () => ({
  getResendClient: () =>
    resendConfigured.value
      ? {
          emails: {
            send: async (payload: { to: string; subject: string; attachments?: Array<{ filename: string; content: unknown }> }) => {
              sentEmails.push(payload);
              return { data: { id: "mock" }, error: null };
            },
          },
        }
      : null,
}));

let mentorId: string;
let menteeId: string;
let mentorEmail: string;
let menteeEmail: string;
const sessionIds: string[] = [];
const slotIds: string[] = [];

beforeAll(async () => {
  const mentor = await createTestUser("confirm-notify-mentor");
  const mentee = await createTestUser("confirm-notify-mentee");
  mentorId = mentor.id;
  menteeId = mentee.id;
  mentorEmail = mentor.email;
  menteeEmail = mentee.email;
  const { error } = await admin.from("mentor_profiles").insert({ user_id: mentorId, status: "approved", base_price_ngn: 15_000 });
  if (error) throw error;
  await admin.from("profiles").update({ first_name: "Ada", last_name: "Mentor" }).eq("id", mentorId);
  await admin.from("profiles").update({ first_name: "Bola", last_name: "Mentee" }).eq("id", menteeId);
}, 60_000);

afterAll(async () => {
  await admin.from("mentor_profiles").delete().eq("user_id", mentorId);
  await deleteTestUsers([mentorId, menteeId]);
}, 60_000);

afterEach(async () => {
  sentEmails.length = 0;
  resendConfigured.value = true;
  if (sessionIds.length) await admin.from("mentorship_sessions").delete().in("id", sessionIds);
  if (slotIds.length) await admin.from("mentor_availability_slots").delete().in("id", slotIds);
  await admin.from("user_notifications").delete().eq("type", "mentorship_session_confirmed").in("user_id", [mentorId, menteeId]);
  sessionIds.length = 0;
  slotIds.length = 0;
});

async function makeConfirmedSession(): Promise<string> {
  const start = new Date(Date.now() + 48 * 3600_000).toISOString();
  const end = new Date(Date.now() + 49 * 3600_000).toISOString();
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
      session_type: "resume_review",
      scheduled_start: start,
      scheduled_end: end,
      price_ngn: 15_000,
      platform_commission_ngn: 2_250,
      mentor_payout_ngn: 12_750,
      status: "confirmed",
      meeting_link: "https://meet.jit.si/talentrah-test-room",
      mentor_confirmed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !session) throw error ?? new Error("no session");
  sessionIds.push(session.id);
  return session.id;
}

describe("notifySessionConfirmed", () => {
  it("emails BOTH parties, each with a calendar invite attached", async () => {
    const sessionId = await makeConfirmedSession();

    const { notifySessionConfirmed } = await import("@/lib/mentorship/notifications");
    await notifySessionConfirmed(sessionId);

    expect(sentEmails).toHaveLength(2);
    const recipients = sentEmails.map((e) => e.to).sort();
    expect(recipients).toEqual([mentorEmail, menteeEmail].sort());
    for (const email of sentEmails) {
      expect(email.attachments, `${email.to}'s confirmation email had no calendar invite attached`).toHaveLength(1);
      expect(email.attachments![0].filename).toBe("mentorship-session.ics");
      const icsText = Buffer.isBuffer(email.attachments![0].content)
        ? (email.attachments![0].content as Buffer).toString("utf8")
        : String(email.attachments![0].content);
      expect(icsText).toContain(`mentorship-session-${sessionId}@talentrah.com`);
    }
  });

  it("writes an in-app notification for BOTH parties", async () => {
    const sessionId = await makeConfirmedSession();

    const { notifySessionConfirmed } = await import("@/lib/mentorship/notifications");
    await notifySessionConfirmed(sessionId);

    const { data } = await admin
      .from("user_notifications")
      .select("user_id, type, link")
      .eq("type", "mentorship_session_confirmed")
      .in("user_id", [mentorId, menteeId]);

    expect(data).toHaveLength(2);
    const byUser = new Map((data ?? []).map((n) => [n.user_id, n]));
    expect(byUser.get(mentorId)?.link).toBe("/mentorship/sessions/mentor");
    expect(byUser.get(menteeId)?.link).toBe("/mentorship/sessions");
  });

  it("still writes the in-app notifications when RESEND_API_KEY is not configured", async () => {
    resendConfigured.value = false;
    const sessionId = await makeConfirmedSession();

    const { notifySessionConfirmed } = await import("@/lib/mentorship/notifications");
    await notifySessionConfirmed(sessionId);

    expect(sentEmails).toHaveLength(0);
    const { data } = await admin
      .from("user_notifications")
      .select("user_id")
      .eq("type", "mentorship_session_confirmed")
      .in("user_id", [mentorId, menteeId]);
    expect(data).toHaveLength(2);
  });

  it("is a safe no-op for a session that is not confirmed (no meeting_link yet) — never throws", async () => {
    const start = new Date(Date.now() + 48 * 3600_000).toISOString();
    const end = new Date(Date.now() + 49 * 3600_000).toISOString();
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

    const { notifySessionConfirmed } = await import("@/lib/mentorship/notifications");
    await expect(notifySessionConfirmed(session!.id)).resolves.toBeUndefined();
    expect(sentEmails).toHaveLength(0);
  });

  it("an authenticated client can never write reminder_sent_at directly — service_role only", async () => {
    const sessionId = await makeConfirmedSession();
    const { sessionFor } = await import("../support/auth");
    const menteeClient = await sessionFor(menteeEmail, menteeId);

    const { error } = await menteeClient
      .from("mentorship_sessions")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", sessionId);

    expect(error, "a column grant is missing — reminder_sent_at must be service_role-only").not.toBeNull();

    const { data } = await admin.from("mentorship_sessions").select("reminder_sent_at").eq("id", sessionId).single();
    expect(data?.reminder_sent_at).toBeNull();
  });
});
