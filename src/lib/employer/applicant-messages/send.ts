import { recipientSkipReason } from "@/lib/email/recipient-eligibility";
import { DAILY_MESSAGE_LIMIT, type MessageKind } from "./constants";
import { normalizeMessage } from "./normalize";
import { buildRelayEmail } from "./relay-email";

export interface RecipientInfo {
  userId: string;
  email: string | null;
  firstName: string | null;
  deletionRequestedAt: string | null;
  jobTitle: string;
  orgName: string;
}

/** Everything the send touches outside itself, so the order of steps and every refusal can be tested without a database or a mail provider. */
export interface SendDeps {
  /** The candidate behind an application that is on THIS job and THIS organisation, or null. Read with the service role; the address stays inside this module. */
  loadRecipient(p: { applicationId: string; jobId: string; organizationId: string }): Promise<RecipientInfo | null>;
  /** claim_applicant_message (0256): one database call that checks the day's 20 and writes the row. Null = the day is full. */
  claim(p: { organizationId: string; applicationId: string; jobId: string; senderUserId: string; kind: MessageKind; subject: string; body: string }): Promise<string | null>;
  /** true = the provider accepted it. */
  deliver(p: { to: string; replyTo: string; fromName: string; subject: string; text: string; html: string }): Promise<boolean>;
  markSent(messageId: string): Promise<void>;
  /** Conditional on status 'claimed', so it gives the slot back once however many times it is called. */
  markFailed(messageId: string, reason: string): Promise<void>;
  notifyCandidate(p: { userId: string; title: string; body: string; link: string }): Promise<void>;
  /** Live messages today (claimed or sent) for the organisation. */
  countToday(organizationId: string): Promise<number>;
}

export interface SendInput {
  organizationId: string;
  jobId: string;
  applicationId: string;
  senderUserId: string;
  /** The sending member's own address: it becomes the Reply-To, so the candidate answers the employer directly. */
  senderEmail: string | null;
  kind: MessageKind;
  subject: unknown;
  body: unknown;
}

export type SendFailure = "invalid" | "not_found" | "unavailable" | "limit" | "no_sender_email" | "send_failed";
export type SendResult = { ok: true; remaining: number } | { ok: false; reason: SendFailure; message: string };

const MESSAGES: Record<Exclude<SendFailure, "invalid">, string> = {
  not_found: "We couldn't find that applicant. Reload the page and try again.",
  unavailable: "This candidate can't be messaged through Talentrah right now.",
  limit: `You've reached today's limit of ${DAILY_MESSAGE_LIMIT} messages. It resets at midnight UTC.`,
  no_sender_email: "Your account has no email address for replies to come to. Add one in Settings, then try again.",
  send_failed: "The message could not be sent, and it did not count against today's limit. Try again in a moment.",
};

/** A display name for the From line: the organisation's name with anything that could end the name or start a header removed. */
function displayName(orgName: string): string {
  const cleaned = orgName.replace(/[<>"\r\n\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return cleaned ? `${cleaned} via Talentrah` : "Talentrah";
}

/**
 * Message candidate: an employer writes to an applicant through Talentrah. In this order, and each step refuses before the next one costs anything:
 * validate the text, resolve the applicant (on this job and organisation only), check the candidate can be mailed, make sure there is an address for replies,
 * claim one of today's slots (one database call), deliver, then mark sent (or failed, which gives the slot back). Never throws. The candidate's address is
 * used for the delivery and goes nowhere else: not into the result, not into a log line, not into the in-app note.
 */
export async function sendApplicantMessage(input: SendInput, deps: SendDeps): Promise<SendResult> {
  const normalized = normalizeMessage({ subject: input.subject, body: input.body });
  if (!normalized.ok) return { ok: false, reason: "invalid", message: normalized.error };

  const recipient = await deps.loadRecipient({ applicationId: input.applicationId, jobId: input.jobId, organizationId: input.organizationId });
  if (!recipient) return { ok: false, reason: "not_found", message: MESSAGES.not_found };
  if (recipientSkipReason({ email: recipient.email, deletion_requested_at: recipient.deletionRequestedAt })) {
    return { ok: false, reason: "unavailable", message: MESSAGES.unavailable };
  }
  const senderEmail = input.senderEmail?.trim();
  if (!senderEmail) return { ok: false, reason: "no_sender_email", message: MESSAGES.no_sender_email };

  let messageId: string | null;
  try {
    messageId = await deps.claim({
      organizationId: input.organizationId,
      applicationId: input.applicationId,
      jobId: input.jobId,
      senderUserId: input.senderUserId,
      kind: input.kind,
      subject: normalized.subject,
      body: normalized.body,
    });
  } catch (error) {
    // A database error is not "the day is full": say the send failed, and nothing was claimed.
    console.error("[applicant-message] could not claim a slot:", error instanceof Error ? error.message : "unknown error");
    return { ok: false, reason: "send_failed", message: MESSAGES.send_failed };
  }
  if (!messageId) return { ok: false, reason: "limit", message: MESSAGES.limit };

  const email = buildRelayEmail({ orgName: recipient.orgName, subject: normalized.subject, body: normalized.body });
  let delivered = false;
  try {
    delivered = await deps.deliver({
      to: recipient.email as string,
      replyTo: senderEmail,
      fromName: displayName(recipient.orgName),
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  } catch {
    // The provider's error can quote the recipient, so it is deliberately not logged or passed on.
    delivered = false;
  }

  if (!delivered) {
    console.error(`[applicant-message] delivery failed for message ${messageId} (organisation ${input.organizationId}); the slot is given back`);
    await deps.markFailed(messageId, "delivery failed").catch(() => {});
    return { ok: false, reason: "send_failed", message: MESSAGES.send_failed };
  }

  await deps.markSent(messageId).catch((error: unknown) => {
    console.error(`[applicant-message] message ${messageId} was delivered but could not be marked sent:`, error instanceof Error ? error.message : "unknown error");
  });
  await deps
    .notifyCandidate({
      userId: recipient.userId,
      title: `${recipient.orgName} sent you a message`,
      body: `About ${recipient.jobTitle}. It was also emailed to you; reply to that email to answer ${recipient.orgName}.`,
      link: "/tracker",
    })
    .catch(() => {});

  const used = await deps.countToday(input.organizationId).catch(() => DAILY_MESSAGE_LIMIT);
  return { ok: true, remaining: Math.max(0, DAILY_MESSAGE_LIMIT - used) };
}
