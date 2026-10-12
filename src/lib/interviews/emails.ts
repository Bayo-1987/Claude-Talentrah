import { emailButton, emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";
import { KIND_LABELS, type InterviewKind } from "./constants";

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

const SIGN = "— Talentrah";

/** The invitation the candidate gets: who, what, how long, how many times, and a link to the signed-in page where the times are shown in their OWN zone (so no clock times are written here). */
export function buildInvitationEmail({
  orgName,
  jobTitle,
  kind,
  note,
  slotCount,
  durationMinutes,
  pickUrl,
}: {
  orgName: string;
  jobTitle: string;
  kind: InterviewKind;
  note: string | null;
  slotCount: number;
  durationMinutes: number;
  pickUrl: string;
}): BuiltEmail {
  const subject = `${orgName} invited you to interview for ${jobTitle}`;
  const kindLabel = KIND_LABELS[kind];
  const intro = `${orgName} would like to interview you for ${jobTitle}. They offered ${slotCount} times (${durationMinutes} minutes, ${kindLabel}). Pick the one that suits you.`;
  const text = [intro, note ? `A note from ${orgName}: ${note}` : null, `Choose a time (sign in to Talentrah): ${pickUrl}`, "If none of the times work, you can say so on the same page.", SIGN].filter(Boolean).join("\n\n");
  const html = renderBrandedEmail({
    bodyHtml: [
      emailParagraph(escEmail(intro)),
      note ? emailParagraph(`A note from ${escEmail(orgName)}: ${escEmail(note)}`) : "",
      emailButton("Choose a time", pickUrl),
      emailParagraph("If none of the times work, you can say so on the same page.", { muted: true }),
    ].join("\n"),
  });
  return { subject, text, html };
}

/** The confirmation each person gets once a time is booked. The time is written in Lagos time with the UTC time beside it; the attached calendar file shows it in each person's own zone. */
export function buildConfirmationEmail({
  audience,
  orgName,
  jobTitle,
  otherName,
  whenText,
  utcText,
  kind,
  note,
  pageUrl,
}: {
  audience: "candidate" | "employer";
  orgName: string;
  jobTitle: string;
  otherName: string;
  whenText: string;
  utcText: string;
  kind: InterviewKind;
  note: string | null;
  pageUrl: string;
}): BuiltEmail {
  const subject = audience === "candidate" ? `Interview confirmed: ${jobTitle} at ${orgName}` : `Interview booked: ${otherName} for ${jobTitle}`;
  const lead =
    audience === "candidate"
      ? `Your interview with ${orgName} for ${jobTitle} is confirmed.`
      : `${otherName} booked an interview for ${jobTitle}.`;
  const details = `${whenText} (${utcText}). ${KIND_LABELS[kind]}.`;
  const text = [lead, details, note ? `Note: ${note}` : null, "A calendar file is attached: open it to add the interview to your calendar in your own time zone.", `Details: ${pageUrl}`, SIGN].filter(Boolean).join("\n\n");
  const html = renderBrandedEmail({
    bodyHtml: [
      emailParagraph(escEmail(lead)),
      emailParagraph(escEmail(details)),
      note ? emailParagraph(`Note: ${escEmail(note)}`) : "",
      emailParagraph("A calendar file is attached: open it to add the interview to your calendar in your own time zone.", { muted: true }),
      emailButton("See the details", pageUrl),
    ].join("\n"),
  });
  return { subject, text, html };
}

/** ONE neutral cancellation notice to the candidate: no reason and nothing about the decision. */
export function buildCancellationEmail({ orgName, jobTitle, whenText }: { orgName: string; jobTitle: string; whenText: string }): BuiltEmail {
  const subject = `Your interview with ${orgName} has been cancelled`;
  const body = `The interview with ${orgName} for ${jobTitle} on ${whenText} has been cancelled.`;
  const text = [body, SIGN].join("\n\n");
  const html = renderBrandedEmail({ bodyHtml: emailParagraph(escEmail(body)) });
  return { subject, text, html };
}

/** To the employer who made the offer: the candidate says none of the offered times work. */
export function buildNoneWorkEmail({ candidateName, jobTitle, scheduleUrl }: { candidateName: string; jobTitle: string; scheduleUrl: string }): BuiltEmail {
  const who = candidateName.trim() || "An applicant";
  const subject = `${who} can't make any of the times you offered`;
  const body = `${who} can't make any of the interview times you offered for ${jobTitle}. You can offer new times.`;
  const text = [body, `Offer new times: ${scheduleUrl}`, SIGN].join("\n\n");
  const html = renderBrandedEmail({ bodyHtml: [emailParagraph(escEmail(body)), emailButton("Offer new times", scheduleUrl)].join("\n") });
  return { subject, text, html };
}

/** The reminder, about 24 hours before: to the candidate and to the member who made the offer. Times in Lagos time with the UTC time beside it (the candidate's page and calendar file show their own zone). */
export function buildReminderEmail({
  audience,
  orgName,
  jobTitle,
  otherName,
  whenText,
  utcText,
  pageUrl,
}: {
  audience: "candidate" | "employer";
  orgName: string;
  jobTitle: string;
  otherName: string;
  whenText: string;
  utcText: string;
  pageUrl: string;
}): BuiltEmail {
  const subject = audience === "candidate" ? `Reminder: your interview with ${orgName} is tomorrow` : `Reminder: your interview with ${otherName} is tomorrow`;
  const body =
    audience === "candidate"
      ? `A reminder: your interview with ${orgName} for ${jobTitle} is ${whenText} (${utcText}).`
      : `A reminder: your interview with ${otherName} for ${jobTitle} is ${whenText} (${utcText}).`;
  const text = [body, `Details: ${pageUrl}`, SIGN].join("\n\n");
  const html = renderBrandedEmail({ bodyHtml: [emailParagraph(escEmail(body)), emailButton("See the details", pageUrl)].join("\n") });
  return { subject, text, html };
}
