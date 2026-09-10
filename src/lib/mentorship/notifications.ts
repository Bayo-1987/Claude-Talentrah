import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { fullVisibleName } from "@/lib/profile/name";
import {
  buildSessionInvite,
  buildSessionConfirmedEmail,
  buildSessionConfirmedInApp,
  buildSessionReminderEmail,
  buildSessionReminderInApp,
  type SessionNotificationContext,
} from "@/lib/notifications/mentorship/template";
import type { MentorshipSessionType } from "@/lib/mentorship/pricing";

/**
 * The two real notification gaps this slice closes — see 0138's migration
 * header for the full "why Jitsi, not Google Meet OAuth" reasoning:
 *
 *   notifySessionConfirmed        — calendar invite (.ics) + email + in-app,
 *                                   to BOTH parties, the moment the mentor
 *                                   confirms. Called from
 *                                   confirmMentorSessionAction
 *                                   (src/lib/mentorship/actions.ts). Before
 *                                   this, mark_mentor_session_confirmed set
 *                                   meeting_link in the database and told no
 *                                   one.
 *
 *   runMentorshipSessionReminders — the cron entry point
 *                                   (src/app/api/admin/mentorship-session-reminders/route.ts),
 *                                   same daily-cron shape as
 *                                   runMentorshipSweep and runPassRenewalJob.
 *
 * BEST-EFFORT ON EMAIL, same framing as billing/renewals.ts's own
 * sendReminderEmail: this repo has no general notification pipeline, Resend
 * is wired ad hoc per feature, and a missing RESEND_API_KEY must not block
 * the thing the email is ABOUT (confirming a session, or the reminder sweep
 * completing). The in-app `user_notifications` row is written regardless —
 * that is the guaranteed surface, same as the renewal reminder's own "the
 * billing page's 'renews on <date>' copy is the actual guaranteed surface
 * either way."
 */

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/** How far ahead of `scheduled_start` the reminder fires. A single number
 * for a daily cron (see the route's own header for why this cannot be an
 * "hour before" promise on this infrastructure): any confirmed session
 * starting within this window, that has not been reminded yet, is due. */
export const REMINDER_WINDOW_HOURS = 24;

interface SessionRow {
  id: string;
  mentor_id: string;
  mentee_id: string;
  session_type: string;
  scheduled_start: string;
  scheduled_end: string;
  meeting_link: string | null;
  status: string;
}

interface ResolvedSession {
  ctx: SessionNotificationContext;
  mentorId: string;
  menteeId: string;
}

async function loadSession(supabase: ServiceClient, sessionId: string): Promise<ResolvedSession | null> {
  const { data: session, error } = await supabase
    .from("mentorship_sessions")
    .select("id, mentor_id, mentee_id, session_type, scheduled_start, scheduled_end, meeting_link, status")
    .eq("id", sessionId)
    .maybeSingle<SessionRow>();
  if (error) throw error;
  if (!session || !session.meeting_link) return null;

  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, first_name, last_name")
    .in("id", [session.mentor_id, session.mentee_id]);
  if (profileError) throw profileError;

  const mentorProfile = profiles?.find((p) => p.id === session.mentor_id);
  const menteeProfile = profiles?.find((p) => p.id === session.mentee_id);
  if (!mentorProfile?.email || !menteeProfile?.email) return null;

  return {
    mentorId: session.mentor_id,
    menteeId: session.mentee_id,
    ctx: {
      sessionId: session.id,
      sessionType: session.session_type as MentorshipSessionType,
      scheduledStart: session.scheduled_start,
      scheduledEnd: session.scheduled_end,
      meetingLink: session.meeting_link,
      mentor: {
        name: fullVisibleName(mentorProfile.first_name, mentorProfile.last_name) || "your mentor",
        email: mentorProfile.email,
      },
      mentee: {
        name: fullVisibleName(menteeProfile.first_name, menteeProfile.last_name) || "your mentee",
        email: menteeProfile.email,
      },
    },
  };
}

async function writeInAppNotification(
  supabase: ServiceClient,
  userId: string,
  type: string,
  notification: { title: string; body: string; link: string },
) {
  const { error } = await supabase.from("user_notifications").insert({
    user_id: userId,
    type,
    title: notification.title,
    body: notification.body,
    link: notification.link,
  });
  // Logged, not fatal — same reasoning proactive-match-alert/send.ts states
  // for its own in-app write: an in-app row failing to write must not also
  // cost the person the email attempt below.
  if (error) console.error(`[mentorship-notifications] in-app write failed (${type}):`, error.message);
}

/**
 * Sends the confirmation-time calendar invite + email + in-app notification
 * to BOTH parties. Safe to call only after mark_mentor_session_confirmed has
 * actually set `meeting_link` — loadSession returns null otherwise, so
 * calling this before confirmation is a no-op rather than a bad send.
 *
 * Never throws — confirmMentorSessionAction's own DB state change already
 * succeeded by the time this runs, and a notification failure must not turn
 * a successful confirmation into a user-facing error for either party.
 */
export async function notifySessionConfirmed(sessionId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  try {
    const resolved = await loadSession(supabase, sessionId);
    if (!resolved) {
      console.error(
        `[mentorship-notifications] session ${sessionId} not ready to notify (no meeting_link yet, or a party has no email on file)`,
      );
      return;
    }
    const { ctx, mentorId, menteeId } = resolved;

    await writeInAppNotification(supabase, mentorId, "mentorship_session_confirmed", buildSessionConfirmedInApp(ctx, "mentor"));
    await writeInAppNotification(supabase, menteeId, "mentorship_session_confirmed", buildSessionConfirmedInApp(ctx, "mentee"));

    const resend = getResendClient();
    if (!resend) {
      console.error("[mentorship-notifications] RESEND_API_KEY is not set — confirmation email not sent, in-app notice still written");
      return;
    }

    const invite = buildSessionInvite(ctx);
    const attachments = [
      { filename: invite.filename, content: Buffer.from(invite.icsContent, "utf8"), contentType: "text/calendar; charset=utf-8; method=REQUEST" },
    ];

    for (const recipient of ["mentor", "mentee"] as const) {
      const to = recipient === "mentor" ? ctx.mentor.email : ctx.mentee.email;
      const email = buildSessionConfirmedEmail(ctx, recipient);
      try {
        await resend.emails.send({
          from: "Talentrah Mentorship <mentorship@talentrah.com>",
          to,
          subject: email.subject,
          text: email.text,
          html: email.html,
          attachments,
        });
      } catch (err) {
        // One recipient's email failing must not skip the other's — each
        // send is independent, so this is caught per-recipient rather than
        // letting the shared for-loop bail after the first failure.
        console.error(`[mentorship-notifications] confirmation email to ${recipient} failed for session ${sessionId}:`, err);
      }
    }
  } catch (err) {
    console.error(`[mentorship-notifications] notifySessionConfirmed(${sessionId}) failed:`, err);
  }
}

export interface SessionReminderSummary {
  /** False only if the work-list query itself failed. */
  ok: boolean;
  considered: number;
  sent: number;
  failed: number;
  errors: Array<{ sessionId: string; message: string }>;
}

/**
 * Entry point for the daily reminder cron
 * (src/app/api/admin/mentorship-session-reminders/route.ts). Finds every
 * CONFIRMED session starting within REMINDER_WINDOW_HOURS that has not yet
 * been reminded, claims each one atomically, and sends.
 */
export async function runMentorshipSessionReminders(now: Date = new Date()): Promise<SessionReminderSummary> {
  const summary: SessionReminderSummary = { ok: true, considered: 0, sent: 0, failed: 0, errors: [] };
  const supabase = createServiceRoleClient();

  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 3600_000).toISOString();
  const { data: due, error } = await supabase
    .from("mentorship_sessions")
    .select("id")
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .gt("scheduled_start", now.toISOString())
    .lte("scheduled_start", windowEnd);

  if (error) {
    console.error(`[mentorship-session-reminders] work-list query failed: ${error.message}`);
    summary.ok = false;
    return summary;
  }

  summary.considered = due?.length ?? 0;

  for (const row of due ?? []) {
    try {
      await processReminder(supabase, row.id, now, summary);
    } catch (err) {
      summary.ok = false;
      summary.errors.push({ sessionId: row.id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}

async function processReminder(supabase: ServiceClient, sessionId: string, now: Date, summary: SessionReminderSummary) {
  /*
   * THE CLAIM, before anything is sent — same "lock first, send second" shape
   * proactive-match-alert/send.ts uses (see its own comment on why), and the
   * same reason mentorship-sweep.ts's cancellation UPDATE is conditioned on
   * `status = 'awaiting_confirmation'`: this route has both a GET (Vercel
   * Cron) and a POST (manual admin trigger) entry point, so two runs CAN
   * overlap in practice, not just in theory. The WHERE clause is the guard —
   * only one caller's UPDATE can ever match a still-null reminder_sent_at,
   * so the loser sees zero rows and correctly does nothing rather than
   * sending a second reminder for the same session.
   */
  const { data: claimed } = await supabase
    .from("mentorship_sessions")
    .update({ reminder_sent_at: now.toISOString() })
    .eq("id", sessionId)
    .eq("status", "confirmed")
    .is("reminder_sent_at", null)
    .select("id")
    .maybeSingle();

  if (!claimed) return; // someone else's run already claimed this session, or its status changed underneath us

  const resolved = await loadSession(supabase, sessionId);
  if (!resolved) {
    // Confirmed with no meeting_link would itself be a real inconsistency —
    // mark_mentor_session_confirmed always sets both together — so this is
    // most likely a party whose profile has no email on file. Logged loudly
    // rather than silently counted as sent.
    console.error(`[mentorship-session-reminders] session ${sessionId} claimed but not notifiable (missing meeting_link or party email)`);
    summary.failed++;
    return;
  }
  const { ctx, mentorId, menteeId } = resolved;

  await writeInAppNotification(supabase, mentorId, "mentorship_session_reminder", buildSessionReminderInApp(ctx, "mentor"));
  await writeInAppNotification(supabase, menteeId, "mentorship_session_reminder", buildSessionReminderInApp(ctx, "mentee"));

  const resend = getResendClient();
  if (!resend) {
    console.error("[mentorship-session-reminders] RESEND_API_KEY is not set — reminder email not sent, in-app notice still written");
    summary.sent++; // the in-app notice is a real, delivered reminder even without email
    return;
  }

  const invite = buildSessionInvite(ctx);
  const attachments = [
    { filename: invite.filename, content: Buffer.from(invite.icsContent, "utf8"), contentType: "text/calendar; charset=utf-8; method=REQUEST" },
  ];

  let anySucceeded = false;
  for (const recipient of ["mentor", "mentee"] as const) {
    const to = recipient === "mentor" ? ctx.mentor.email : ctx.mentee.email;
    const email = buildSessionReminderEmail(ctx, recipient);
    try {
      await resend.emails.send({
        from: "Talentrah Mentorship <mentorship@talentrah.com>",
        to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments,
      });
      anySucceeded = true;
    } catch (err) {
      console.error(`[mentorship-session-reminders] reminder email to ${recipient} failed for session ${sessionId}:`, err);
    }
  }
  if (anySucceeded) summary.sent++;
  else summary.failed++;
}
