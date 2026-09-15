import { buildSessionCalendarInvite, type CalendarInviteAttendee } from "@/lib/mentorship/calendar-invite";
import type { MentorshipSessionType } from "@/lib/mentorship/pricing";

/**
 * Mentorship session notifications — confirmation invite and pre-session
 * reminder. Neutral system voice throughout, not Farah's: §6.10's own split
 * is Farah-voiced for relationship-y things she is actually part of (matches,
 * referrals) and neutral for factual/transactional ones — a paid booking
 * between a mentor and a mentee, with a specific time and a specific link, is
 * the latter. Structured plainly for the same reason the digest/renewal
 * emails are: this is a receipt for an appointment, not a pitch.
 */

const SESSION_TYPE_LABEL: Record<MentorshipSessionType, string> = {
  resume_review: "Resume review",
  mock_interview: "Mock interview",
  career_strategy: "Career strategy session",
  negotiation_strategy: "Negotiation strategy session",
  quick_question: "Quick question",
};

export function sessionTypeLabel(sessionType: MentorshipSessionType): string {
  return SESSION_TYPE_LABEL[sessionType] ?? sessionType.replace(/_/g, " ");
}

/**
 * Africa/Lagos specifically, not the server's local zone: this app's target
 * market (build-prompt's own Nigeria/Africa framing) reads "3:00 PM" as WAT,
 * and there is no per-user timezone preference anywhere in this schema to
 * localise against instead — the honest default is the market's own zone,
 * not UTC or whatever zone the deployment happens to run in.
 */
function formatSessionTime(iso: string): string {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

export interface SessionParticipant {
  name: string;
  email: string;
}

export interface SessionNotificationContext {
  sessionId: string;
  sessionType: MentorshipSessionType;
  scheduledStart: string;
  scheduledEnd: string;
  meetingLink: string;
  mentor: SessionParticipant;
  mentee: SessionParticipant;
}

const ORGANIZER: CalendarInviteAttendee = { name: "Talentrah", email: "sessions@talentrah.com" };

function participantsForInvite(ctx: SessionNotificationContext): CalendarInviteAttendee[] {
  return [
    { name: ctx.mentor.name, email: ctx.mentor.email },
    { name: ctx.mentee.name, email: ctx.mentee.email },
  ];
}

function inviteDescription(ctx: SessionNotificationContext, counterpartName: string): string {
  return [
    `${sessionTypeLabel(ctx.sessionType)} on Talentrah, with ${counterpartName}.`,
    `Join the call: ${ctx.meetingLink}`,
  ].join("\n\n");
}

/** The calendar invite is identical for both parties (same UID, same time,
 * same link) — only the confirmation EMAIL text below addresses each of them
 * by their counterpart's name. */
export function buildSessionInvite(ctx: SessionNotificationContext) {
  return buildSessionCalendarInvite({
    sessionId: ctx.sessionId,
    summary: `${sessionTypeLabel(ctx.sessionType)} — Talentrah Mentorship`,
    description: inviteDescription(ctx, "your Talentrah mentorship counterpart"),
    meetingLink: ctx.meetingLink,
    scheduledStart: ctx.scheduledStart,
    scheduledEnd: ctx.scheduledEnd,
    organizer: ORGANIZER,
    attendees: participantsForInvite(ctx),
    sequence: 0,
  });
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface SessionEmail {
  subject: string;
  text: string;
  html: string;
}

function baseEmailHtml(bodyParagraphs: string[], sessionType: MentorshipSessionType, when: string, meetingLink: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f3ec;">
  <div style="max-width:560px;margin:0 auto;">
    ${bodyParagraphs
      .map(
        (p) =>
          `<p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#2b2119;">${p}</p>`,
      )
      .join("\n    ")}
    <div style="padding:16px 0;border-top:1px solid #d9cfc2;border-bottom:1px solid #d9cfc2;">
      <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#6b4a3a;">
        ${esc(sessionTypeLabel(sessionType))}
      </div>
      <div style="font:500 17px/1.35 Georgia,'Times New Roman',serif;color:#2b2119;margin-top:2px;">
        ${esc(when)}
      </div>
    </div>
    <p style="margin:24px 0;">
      <a href="${esc(meetingLink)}"
         style="display:inline-block;background:#2b2119;color:#f7f3ec;text-decoration:none;
                padding:12px 20px;font:600 14px/1 -apple-system,Segoe UI,Roboto,sans-serif;">
        Join the call
      </a>
    </p>
    <p style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#6b5c50;">— Talentrah</p>
  </div>
</body></html>`;
}

/**
 * The confirmation email — sent to BOTH parties once the mentor confirms
 * (src/lib/notifications/mentorship/send.ts's notifySessionConfirmed). The
 * `.ics` this pairs with (buildSessionInvite above) is what actually lands
 * on a calendar; this email is what a person reads before they get there.
 */
export function buildSessionConfirmedEmail(
  ctx: SessionNotificationContext,
  recipient: "mentor" | "mentee",
): SessionEmail {
  const counterpart = recipient === "mentor" ? ctx.mentee : ctx.mentor;
  const when = formatSessionTime(ctx.scheduledStart);
  const subject = `Confirmed: ${sessionTypeLabel(ctx.sessionType)} with ${counterpart.name}`;

  const text = [
    `Your ${sessionTypeLabel(ctx.sessionType).toLowerCase()} with ${counterpart.name} is confirmed.`,
    "",
    `When: ${when}`,
    `Where: ${ctx.meetingLink}`,
    "",
    "A calendar invite is attached — add it so this doesn't slip past you.",
    "",
    "— Talentrah",
  ].join("\n");

  const html = baseEmailHtml(
    [
      `Your ${esc(sessionTypeLabel(ctx.sessionType).toLowerCase())} with ${esc(counterpart.name)} is confirmed.`,
      "A calendar invite is attached — add it so this doesn&rsquo;t slip past you.",
    ],
    ctx.sessionType,
    when,
    ctx.meetingLink,
  );

  return { subject, text, html };
}

/**
 * The pre-session reminder — sent once per session, `REMINDER_WINDOW_HOURS`
 * before `scheduled_start` (src/lib/notifications/mentorship/send.ts's
 * runMentorshipSessionReminders). Re-states the link and time rather than
 * assuming the confirmation email from possibly days earlier is still handy.
 */
export function buildSessionReminderEmail(
  ctx: SessionNotificationContext,
  recipient: "mentor" | "mentee",
): SessionEmail {
  const counterpart = recipient === "mentor" ? ctx.mentee : ctx.mentor;
  const when = formatSessionTime(ctx.scheduledStart);
  const subject = `Reminder: ${sessionTypeLabel(ctx.sessionType)} with ${counterpart.name}`;

  const text = [
    `Your ${sessionTypeLabel(ctx.sessionType).toLowerCase()} with ${counterpart.name} is coming up.`,
    "",
    `When: ${when}`,
    `Where: ${ctx.meetingLink}`,
    "",
    "— Talentrah",
  ].join("\n");

  const html = baseEmailHtml(
    [`Your ${esc(sessionTypeLabel(ctx.sessionType).toLowerCase())} with ${esc(counterpart.name)} is coming up.`],
    ctx.sessionType,
    when,
    ctx.meetingLink,
  );

  return { subject, text, html };
}

export interface SessionInAppNotification {
  title: string;
  body: string;
  link: string;
}

export function buildSessionConfirmedInApp(
  ctx: SessionNotificationContext,
  recipient: "mentor" | "mentee",
): SessionInAppNotification {
  const counterpart = recipient === "mentor" ? ctx.mentee : ctx.mentor;
  return {
    title: "Session confirmed",
    body: `Your ${sessionTypeLabel(ctx.sessionType).toLowerCase()} with ${counterpart.name} is confirmed for ${formatSessionTime(ctx.scheduledStart)}.`,
    link: recipient === "mentor" ? "/mentorship/sessions/mentor" : "/mentorship/sessions",
  };
}

export function buildSessionReminderInApp(
  ctx: SessionNotificationContext,
  recipient: "mentor" | "mentee",
): SessionInAppNotification {
  const counterpart = recipient === "mentor" ? ctx.mentee : ctx.mentor;
  return {
    title: "Session coming up",
    body: `Your ${sessionTypeLabel(ctx.sessionType).toLowerCase()} with ${counterpart.name} starts ${formatSessionTime(ctx.scheduledStart)}.`,
    link: recipient === "mentor" ? "/mentorship/sessions/mentor" : "/mentorship/sessions",
  };
}
