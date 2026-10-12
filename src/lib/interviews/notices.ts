import { buildCancellationEmail, buildReminderEmail } from "./emails";
import { formatInterviewRange } from "./format";
import { EMPLOYER_EMAIL_ZONE } from "./booking";

export interface NoticeBooking {
  bookingId: string;
  applicationId: string;
  jobId: string;
  organizationId: string;
  startsAt: string;
  durationMinutes: number;
}

export interface NoticeContext {
  orgName: string;
  jobTitle: string;
  offerId: string;
  candidateName: string;
  candidateEmail: string | null;
  /** The member who made the offer. */
  employerEmail: string | null;
}

export interface NoticeDeps {
  /** cancel_stale_interview_bookings + expire_interview_offers (0253): the backstops for anything the triggers missed. Returns how many of each. */
  sweep(): Promise<{ cancelled: number; expired: number }>;
  /** claim_interview_cancellation_emails: cancelled bookings whose ONE neutral email is unsent, claimed exactly once (skip locked). */
  claimCancellations(): Promise<NoticeBooking[]>;
  releaseCancellation(bookingId: string): Promise<void>;
  /** claim_interview_reminders(from, to): booked interviews starting in the window, once per booking, skipping cancelled bookings and deleting applicants. */
  claimReminders(from: Date, to: Date): Promise<NoticeBooking[]>;
  releaseReminder(bookingId: string): Promise<void>;
  context(booking: NoticeBooking): Promise<NoticeContext | null>;
  send(p: { to: string; subject: string; text: string; html: string }): Promise<boolean>;
  candidateUrl(offerId: string): string;
  employerUrl(jobId: string, applicationId: string): string;
}

export interface NoticeSummary {
  ok: boolean;
  cancelledByBackstop: number;
  expired: number;
  cancellationsClaimed: number;
  cancellationsSent: number;
  cancellationsReleased: number;
  remindersClaimed: number;
  remindersSent: number;
  remindersReleased: number;
}

export const REMINDER_FROM_HOURS = 23;
export const REMINDER_TO_HOURS = 25;

const utcClock = (iso: string) => `${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" }).format(new Date(iso))} UTC`;

/**
 * The scheduled interview emails, run hourly. (1) The backstops: cancel anything the trigger missed and close offers whose times have all passed. (2) The cancellation notice: ONE neutral email to the CANDIDATE (the employer acted) for each
 * booking the employer's 'not a fit' cancelled, claimed once in the database; released if the send failed so the next run retries. (3) The reminder, 23 to 25 hours ahead (the window is two hours wide so an hourly run always sees a booking once, and
 * the database marks each booking once): one email to the candidate and one to the member who made the offer; the mark is released only if NEITHER went out. Nothing here touches the 20/day allowance. Never throws.
 */
export async function runInterviewNotices(deps: NoticeDeps, now: Date = new Date()): Promise<NoticeSummary> {
  const summary: NoticeSummary = { ok: true, cancelledByBackstop: 0, expired: 0, cancellationsClaimed: 0, cancellationsSent: 0, cancellationsReleased: 0, remindersClaimed: 0, remindersSent: 0, remindersReleased: 0 };

  try {
    const swept = await deps.sweep();
    summary.cancelledByBackstop = swept.cancelled;
    summary.expired = swept.expired;
  } catch (error) {
    console.error("[interview-notices] the backstop sweep failed:", error instanceof Error ? error.message : "unknown error");
    summary.ok = false;
  }

  try {
    const cancellations = await deps.claimCancellations();
    summary.cancellationsClaimed = cancellations.length;
    for (const booking of cancellations) {
      let sent = false;
      try {
        const context = await deps.context(booking);
        if (!context?.candidateEmail) {
          // A candidate with no address (deleted or leaving) is not emailed: nothing to retry, so the claim stays.
          continue;
        }
        const mail = buildCancellationEmail({ orgName: context.orgName, jobTitle: context.jobTitle, whenText: formatInterviewRange(booking.startsAt, booking.durationMinutes, EMPLOYER_EMAIL_ZONE) });
        sent = await deps.send({ to: context.candidateEmail, subject: mail.subject, text: mail.text, html: mail.html });
      } catch {
        sent = false;
      }
      if (sent) summary.cancellationsSent += 1;
      else {
        await deps.releaseCancellation(booking.bookingId).catch(() => {});
        summary.cancellationsReleased += 1;
        summary.ok = false;
      }
    }
  } catch (error) {
    console.error("[interview-notices] the cancellation step failed:", error instanceof Error ? error.message : "unknown error");
    summary.ok = false;
  }

  try {
    const reminders = await deps.claimReminders(new Date(now.getTime() + REMINDER_FROM_HOURS * 3_600_000), new Date(now.getTime() + REMINDER_TO_HOURS * 3_600_000));
    summary.remindersClaimed = reminders.length;
    for (const booking of reminders) {
      let delivered = 0;
      let attempted = 0;
      try {
        const context = await deps.context(booking);
        if (context) {
          const common = { orgName: context.orgName, jobTitle: context.jobTitle, utcText: utcClock(booking.startsAt), whenText: formatInterviewRange(booking.startsAt, booking.durationMinutes, EMPLOYER_EMAIL_ZONE) };
          const targets: Array<{ to: string; audience: "candidate" | "employer" }> = [];
          if (context.candidateEmail) targets.push({ to: context.candidateEmail, audience: "candidate" });
          if (context.employerEmail) targets.push({ to: context.employerEmail, audience: "employer" });
          for (const target of targets) {
            attempted += 1;
            const mail = buildReminderEmail({
              ...common,
              audience: target.audience,
              otherName: target.audience === "candidate" ? context.orgName : context.candidateName || "an applicant",
              pageUrl: target.audience === "candidate" ? deps.candidateUrl(context.offerId) : deps.employerUrl(booking.jobId, booking.applicationId),
            });
            try {
              if (await deps.send({ to: target.to, subject: mail.subject, text: mail.text, html: mail.html })) delivered += 1;
            } catch {
              // counted as not delivered; the provider's error can quote an address and is not logged
            }
          }
        }
      } catch {
        attempted = Math.max(attempted, 1);
      }
      if (delivered > 0) summary.remindersSent += delivered;
      else if (attempted > 0) {
        await deps.releaseReminder(booking.bookingId).catch(() => {});
        summary.remindersReleased += 1;
        summary.ok = false;
      }
    }
  } catch (error) {
    console.error("[interview-notices] the reminder step failed:", error instanceof Error ? error.message : "unknown error");
    summary.ok = false;
  }

  console.log(`[interview-notices] cancelled=${summary.cancelledByBackstop} expired=${summary.expired} cancel_claimed=${summary.cancellationsClaimed} cancel_sent=${summary.cancellationsSent} cancel_released=${summary.cancellationsReleased} remind_claimed=${summary.remindersClaimed} remind_sent=${summary.remindersSent} remind_released=${summary.remindersReleased}`);
  return summary;
}
