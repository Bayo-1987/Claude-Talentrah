import { buildIcs } from "./ics";
import { buildCancellationEmail, buildConfirmationEmail, buildNoneWorkEmail } from "./emails";
import { formatInterviewRange } from "./format";
import { formatTime } from "@/lib/format/datetime";
import type { InterviewKind } from "./constants";

/** Where the employer's emails read the time: Lagos (UTC+1 all year); the candidate's emails read it in the zone their browser reported. The calendar file is UTC either way. */
export const EMPLOYER_EMAIL_ZONE = "Africa/Lagos";

export interface BookingContext {
  orgName: string;
  jobTitle: string;
  kind: InterviewKind;
  note: string | null;
  durationMinutes: number;
  offerId: string;
  jobId: string;
  applicationId: string;
  candidateName: string;
  candidateEmail: string | null;
  /** The member who made the offer: the employer-side recipient of the confirmation. */
  employerEmail: string | null;
}

export interface MailWithCalendar {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: Array<{ filename: string; content: string }>;
}

export interface BookDeps {
  /** book_interview_slot (0253): ownership and the atomic claim in SQL. */
  book(p: { userId: string; slotId: string }): Promise<{ ok: boolean; outcome: string; bookingId: string | null; startsAt: string | null }>;
  context(bookingId: string): Promise<BookingContext | null>;
  deliver(mail: MailWithCalendar): Promise<boolean>;
  candidateUrl(offerId: string): string;
  employerUrl(jobId: string, applicationId: string): string;
}

export type BookFailure = "slot_taken" | "closed" | "already_booked" | "too_late" | "not_found" | "failed";
export type BookResult = { ok: true; startsAt: string } | { ok: false; reason: BookFailure; message: string };

const FAILURES: Record<string, { reason: BookFailure; message: string }> = {
  slot_taken: { reason: "slot_taken", message: "That time was just taken. Pick another of the times offered." },
  offer_closed: { reason: "closed", message: "This invitation is no longer open." },
  expired: { reason: "closed", message: "These times have all passed, so this invitation has expired. Ask the employer to offer new times." },
  already_booked: { reason: "already_booked", message: "You have already booked a time for this interview." },
  too_late: { reason: "too_late", message: "That time has already passed." },
  not_owner: { reason: "not_found", message: "We couldn't find that invitation." },
  not_found: { reason: "not_found", message: "We couldn't find that invitation." },
};

const utcClock = (iso: string) => formatTime(iso, { timeZone: "UTC" });

/**
 * The candidate books one offered time. The database decides (ownership, the atomic claim: the loser of a race gets "That time was just taken"); this then sends the confirmation, with a calendar
 * file, to BOTH people (the candidate and the member who made the offer). A confirmation that cannot be sent never un-books the interview. Never throws; neither person is given the other's email address.
 */
export async function bookInterviewSlot(input: { userId: string; slotId: string; timeZone: string }, deps: BookDeps): Promise<BookResult> {
  let booked: Awaited<ReturnType<BookDeps["book"]>>;
  try {
    booked = await deps.book({ userId: input.userId, slotId: input.slotId });
  } catch (error) {
    console.error("[interview-booking] could not book:", error instanceof Error ? error.message : "unknown error");
    return { ok: false, reason: "failed", message: "Couldn't book that time. Try again in a moment." };
  }
  if (!booked.ok || !booked.bookingId || !booked.startsAt) {
    const mapped = FAILURES[booked.outcome] ?? { reason: "failed" as const, message: "Couldn't book that time. Try again in a moment." };
    return { ok: false, reason: mapped.reason, message: mapped.message };
  }

  try {
    const context = await deps.context(booked.bookingId);
    if (context) {
      const ics = buildIcs({
        uid: `${booked.bookingId}@talentrah.com`,
        startsAtIso: booked.startsAt,
        durationMinutes: context.durationMinutes,
        summary: `Interview: ${context.jobTitle} at ${context.orgName}`,
        description: context.note ? `${context.note}` : undefined,
      });
      const attachments = [{ filename: "interview.ics", content: ics }];
      const utcText = utcClock(booked.startsAt);
      const common = { orgName: context.orgName, jobTitle: context.jobTitle, kind: context.kind, note: context.note, utcText };

      const sends: Array<Promise<boolean>> = [];
      if (context.candidateEmail) {
        const mail = buildConfirmationEmail({ ...common, audience: "candidate", otherName: context.orgName, whenText: formatInterviewRange(booked.startsAt, context.durationMinutes, input.timeZone), pageUrl: deps.candidateUrl(context.offerId) });
        sends.push(deps.deliver({ to: context.candidateEmail, subject: mail.subject, text: mail.text, html: mail.html, attachments }));
      }
      if (context.employerEmail) {
        const mail = buildConfirmationEmail({ ...common, audience: "employer", otherName: context.candidateName || "An applicant", whenText: formatInterviewRange(booked.startsAt, context.durationMinutes, EMPLOYER_EMAIL_ZONE), pageUrl: deps.employerUrl(context.jobId, context.applicationId) });
        sends.push(deps.deliver({ to: context.employerEmail, subject: mail.subject, text: mail.text, html: mail.html, attachments }));
      }
      await Promise.allSettled(sends);
    }
  } catch (error) {
    console.error("[interview-booking] the booking stands but the confirmation could not be built:", error instanceof Error ? error.message : "unknown error");
  }
  return { ok: true, startsAt: booked.startsAt };
}

export interface NoneWorkDeps {
  /** The offer, only if it belongs to this candidate (their own application), with the member who made it. */
  load(p: { userId: string; offerId: string }): Promise<{ state: string; creatorUserId: string | null; creatorEmail: string | null; candidateName: string; jobTitle: string; jobId: string; applicationId: string } | null>;
  alreadyReported(p: { offerId: string; creatorUserId: string }): Promise<boolean>;
  note(p: { creatorUserId: string; offerId: string; candidateName: string; jobTitle: string; link: string }): Promise<void>;
  deliver(p: { to: string; subject: string; text: string; html: string }): Promise<boolean>;
  scheduleUrl(jobId: string, applicationId: string): string;
}

/** "None of these times work": tells the member who made the offer (in the app and by email, once per offer). It touches no allowance and leaves the offer open. */
export async function reportNoneWork(input: { userId: string; offerId: string }, deps: NoneWorkDeps): Promise<{ ok: true } | { ok: false; reason: "not_found" | "closed" | "failed"; message: string }> {
  try {
    const offer = await deps.load(input);
    if (!offer) return { ok: false, reason: "not_found", message: "We couldn't find that invitation." };
    if (offer.state !== "open") return { ok: false, reason: "closed", message: "This invitation is no longer open." };
    if (!offer.creatorUserId) return { ok: true };
    if (await deps.alreadyReported({ offerId: input.offerId, creatorUserId: offer.creatorUserId })) return { ok: true };

    const link = deps.scheduleUrl(offer.jobId, offer.applicationId);
    await deps.note({ creatorUserId: offer.creatorUserId, offerId: input.offerId, candidateName: offer.candidateName, jobTitle: offer.jobTitle, link });
    if (offer.creatorEmail) {
      const mail = buildNoneWorkEmail({ candidateName: offer.candidateName, jobTitle: offer.jobTitle, scheduleUrl: link });
      await deps.deliver({ to: offer.creatorEmail, subject: mail.subject, text: mail.text, html: mail.html }).catch(() => false);
    }
    return { ok: true };
  } catch (error) {
    console.error("[interview-none-work] failed:", error instanceof Error ? error.message : "unknown error");
    return { ok: false, reason: "failed", message: "Couldn't pass that on. Try again in a moment." };
  }
}

export { buildCancellationEmail };
