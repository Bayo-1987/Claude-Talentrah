import { NOTE_MAX, isInterviewKind } from "./constants";
import { buildInvitationEmail } from "./emails";
import { validateSlots } from "./slots-input";

export interface OfferDeps {
  /** The organisation and job names and the candidate behind an application that is on THIS job and organisation (service role; the address stays inside this module), or null. */
  context(p: { applicationId: string; jobId: string; organizationId: string }): Promise<{ orgName: string; jobTitle: string; candidateEmail: string | null; deletionRequestedAt: string | null } | null>;
  /** create_interview_offer (0253): every rule in SQL, the shared 20/day unit claimed LAST. */
  createOffer(p: { userId: string; applicationId: string; kind: string; note: string | null; slots: Array<{ starts_at: string; duration_minutes: number }> }): Promise<{ ok: boolean; outcome: string; offerId: string | null; messageId: string | null }>;
  deliver(p: { to: string; replyTo: string; fromName: string; subject: string; text: string; html: string }): Promise<boolean>;
  /** Hands the claimed unit back: a conditional update on applicant_messages (status 'claimed' only), so it happens once. */
  freeUnit(messageId: string): Promise<void>;
  pickUrl(offerId: string): string;
}

export interface OfferInput {
  organizationId: string;
  jobId: string;
  applicationId: string;
  userId: string;
  senderEmail: string | null;
  kind: string;
  note: string | null;
  times: string[];
  durationMinutes: number;
  /** For tests. */
  now?: Date;
}

export type OfferFailure = "invalid" | "not_found" | "unavailable" | "no_sender_email" | "job_not_open" | "application_closed" | "already_open" | "limit" | "send_failed" | "failed";
export type OfferResult = { ok: true; offerId: string } | { ok: false; reason: OfferFailure; message: string; offerId?: string };

const MESSAGES: Record<string, { reason: OfferFailure; message: string }> = {
  not_found: { reason: "not_found", message: "We couldn't find that applicant. Reload the page and try again." },
  job_not_open: { reason: "job_not_open", message: "This job is not open, so you can't invite anyone to interview for it." },
  application_closed: { reason: "application_closed", message: "This applicant can't be invited right now: they were marked as not a fit or hired, or their account is closing." },
  already_open: { reason: "already_open", message: "There is already an open invitation for this applicant." },
  rate_limited: { reason: "limit", message: "You've reached today's limit of 20 messages and invitations. It resets at midnight UTC." },
  bad_slots: { reason: "invalid", message: "Check the times: offer 2 to 5 different times, each at least an hour from now and within 60 days." },
  bad_kind: { reason: "invalid", message: "Choose video, phone or in person." },
  bad_note: { reason: "invalid", message: `Keep the note under ${NOTE_MAX} characters.` },
};

function displayName(orgName: string): string {
  const cleaned = orgName.replace(/[<>"\r\n\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return cleaned ? `${cleaned} via Talentrah` : "Talentrah";
}

/**
 * An employer offers 2 to 5 times to an applicant. Each step refuses before the next costs anything: validate the kind, note and times; resolve the applicant (on this job and organisation only) and
 * check they can be mailed; require a Reply-To; then ONE database call creates the offer (it spends one unit of the shared 20/day allowance last, and a refused call spends nothing); then ONE
 * invitation email. If that email cannot be sent the unit is handed back and the employer is told, with the offer kept so it can be resent. Never throws; the candidate's address is used for the delivery only.
 */
export async function createInterviewOffer(input: OfferInput, deps: OfferDeps): Promise<OfferResult> {
  if (!isInterviewKind(input.kind)) return { ok: false, reason: "invalid", message: MESSAGES.bad_kind.message };
  const note = input.note?.trim() ? input.note.trim() : null;
  if (note && note.length > NOTE_MAX) return { ok: false, reason: "invalid", message: MESSAGES.bad_note.message };
  const slots = validateSlots({ times: input.times, durationMinutes: input.durationMinutes }, input.now);
  if (!slots.ok) return { ok: false, reason: "invalid", message: slots.error };

  const context = await deps.context({ applicationId: input.applicationId, jobId: input.jobId, organizationId: input.organizationId }).catch(() => null);
  if (!context) return { ok: false, reason: "not_found", message: MESSAGES.not_found.message };
  if (context.deletionRequestedAt || !context.candidateEmail?.trim()) {
    return { ok: false, reason: "unavailable", message: "This candidate can't be invited through Talentrah right now." };
  }
  const senderEmail = input.senderEmail?.trim();
  if (!senderEmail) return { ok: false, reason: "no_sender_email", message: "Your account has no email address for replies to come to. Add one in Settings, then try again." };

  let created: Awaited<ReturnType<OfferDeps["createOffer"]>>;
  try {
    created = await deps.createOffer({ userId: input.userId, applicationId: input.applicationId, kind: input.kind, note, slots: slots.slots });
  } catch (error) {
    console.error("[interview-offer] could not create the offer:", error instanceof Error ? error.message : "unknown error");
    return { ok: false, reason: "failed", message: "Couldn't create the invitation. Try again in a moment." };
  }
  if (!created.ok || !created.offerId) {
    const mapped = MESSAGES[created.outcome] ?? { reason: "failed" as const, message: "Couldn't create the invitation. Try again in a moment." };
    return { ok: false, reason: mapped.reason, message: mapped.message };
  }

  const email = buildInvitationEmail({
    orgName: context.orgName,
    jobTitle: context.jobTitle,
    kind: input.kind,
    note,
    slotCount: slots.slots.length,
    durationMinutes: input.durationMinutes,
    pickUrl: deps.pickUrl(created.offerId),
  });
  let delivered = false;
  try {
    delivered = await deps.deliver({ to: context.candidateEmail, replyTo: senderEmail, fromName: displayName(context.orgName), subject: email.subject, text: email.text, html: email.html });
  } catch {
    delivered = false; // the provider's error can quote the address: not logged
  }
  if (!delivered) {
    console.error(`[interview-offer] the invitation email for offer ${created.offerId} could not be sent: the unit is handed back`);
    if (created.messageId) await deps.freeUnit(created.messageId).catch(() => {});
    return { ok: false, reason: "send_failed", offerId: created.offerId, message: "The invitation was created but the email could not be sent, and it did not count against today's limit. Send it again from this applicant's schedule page." };
  }
  return { ok: true, offerId: created.offerId };
}

export interface ResendDeps {
  /** The open offer for this application on THIS job and organisation, with what the email needs; null when there is none open. */
  load(p: { applicationId: string; jobId: string; organizationId: string }): Promise<{ offerId: string; kind: string; note: string | null; slotCount: number; durationMinutes: number; orgName: string; jobTitle: string; candidateEmail: string | null; deletionRequestedAt: string | null } | null>;
  /** claim_applicant_message with kind 'interview_invite': one unit of the shared 20/day allowance, or null when the day is full. */
  claimUnit(p: { organizationId: string; applicationId: string; jobId: string; userId: string; subject: string }): Promise<string | null>;
  deliver: OfferDeps["deliver"];
  freeUnit: OfferDeps["freeUnit"];
  pickUrl: OfferDeps["pickUrl"];
}

/** Send the invitation for an OPEN offer again (the first email failed, or the candidate lost it). It costs one unit of the shared allowance, handed back if this email fails too. Never throws. */
export async function resendInterviewInvitation(input: { organizationId: string; jobId: string; applicationId: string; userId: string; senderEmail: string | null }, deps: ResendDeps): Promise<{ ok: true } | { ok: false; reason: "not_found" | "unavailable" | "no_sender_email" | "limit" | "send_failed"; message: string }> {
  const senderEmail = input.senderEmail?.trim();
  if (!senderEmail) return { ok: false, reason: "no_sender_email", message: "Your account has no email address for replies to come to. Add one in Settings, then try again." };
  const offer = await deps.load(input).catch(() => null);
  if (!offer) return { ok: false, reason: "not_found", message: "There is no open invitation to send again." };
  if (offer.deletionRequestedAt || !offer.candidateEmail?.trim()) return { ok: false, reason: "unavailable", message: "This candidate can't be invited through Talentrah right now." };
  if (!isInterviewKind(offer.kind)) return { ok: false, reason: "not_found", message: "There is no open invitation to send again." };

  const email = buildInvitationEmail({ orgName: offer.orgName, jobTitle: offer.jobTitle, kind: offer.kind, note: offer.note, slotCount: offer.slotCount, durationMinutes: offer.durationMinutes, pickUrl: deps.pickUrl(offer.offerId) });
  const unit = await deps.claimUnit({ organizationId: input.organizationId, applicationId: input.applicationId, jobId: input.jobId, userId: input.userId, subject: email.subject.slice(0, 200) }).catch(() => null);
  if (!unit) return { ok: false, reason: "limit", message: MESSAGES.rate_limited.message };

  let delivered = false;
  try {
    delivered = await deps.deliver({ to: offer.candidateEmail, replyTo: senderEmail, fromName: displayName(offer.orgName), subject: email.subject, text: email.text, html: email.html });
  } catch {
    delivered = false;
  }
  if (!delivered) {
    await deps.freeUnit(unit).catch(() => {});
    return { ok: false, reason: "send_failed", message: "The email could not be sent, and it did not count against today's limit. Try again in a moment." };
  }
  return { ok: true };
}
