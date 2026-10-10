import { SUBJECT_MAX, type MessageTemplateKind } from "./constants";

export interface TemplateContext {
  candidateFirstName: string | null;
  jobTitle: string;
  orgName: string;
  senderFirstName: string | null;
}

/**
 * The three starting points on the Message candidate form. Fixed text that the employer reads and edits before anything is sent: no model, no invented dates, no pay,
 * no reason given for a decision. Anything fancier is the Premium "Draft with Farah" path, which also never sends by itself.
 */
/** A long job title and organisation name must not make a template's own subject fail the limit the send enforces. */
const clampSubject = (subject: string) => (subject.length <= SUBJECT_MAX ? subject : `${subject.slice(0, SUBJECT_MAX - 1).trimEnd()}…`);

export function buildTemplate(kind: MessageTemplateKind, ctx: TemplateContext): { subject: string; body: string } {
  const built = buildUnclamped(kind, ctx);
  return { subject: clampSubject(built.subject), body: built.body };
}

function buildUnclamped(kind: MessageTemplateKind, ctx: TemplateContext): { subject: string; body: string } {
  const greeting = `Hi ${ctx.candidateFirstName?.trim() || "there"},`;
  const signoff = `Best regards,\n${[ctx.senderFirstName?.trim(), ctx.orgName].filter(Boolean).join(", ")}`;

  switch (kind) {
    case "invite_interview":
      return {
        subject: `Interview for ${ctx.jobTitle} at ${ctx.orgName}`,
        body: `${greeting}\n\nThank you for applying for ${ctx.jobTitle}. We'd like to invite you to an interview. Could you share a couple of times that work for you?\n\n${signoff}`,
      };
    case "request_info":
      return {
        subject: `A question about your application for ${ctx.jobTitle}`,
        body: `${greeting}\n\nThank you for applying for ${ctx.jobTitle}. Before we go further, we'd like to ask for a little more information:\n\n[Write your question here]\n\n${signoff}`,
      };
    case "not_moving_forward":
      return {
        subject: `Your application for ${ctx.jobTitle} at ${ctx.orgName}`,
        body: `${greeting}\n\nThank you for applying for ${ctx.jobTitle} and for the time you put into it. We've decided not to move forward with your application for this role. We appreciate your interest in ${ctx.orgName} and wish you well in your search.\n\n${signoff}`,
      };
  }
}
