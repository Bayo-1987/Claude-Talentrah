import { emailButton, emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";
import { formatDate } from "@/lib/format/datetime";
import { EXTEND_DAYS } from "./constants";

/**
 * The 3-day closing reminder. Pure: it takes already-built URLs and returns the three strings, so it is tested without
 * a mailer, and the run (send.ts) stays about who gets mailed rather than what the mail says.
 *
 * TRANSACTIONAL, in the same voice as the verification reminder (src/lib/employer-verification-reminders/send.ts): a
 * factual note from the system about the employer's own posting, no Farah, no unsubscribe footer (it is not a
 * marketing send), logo shown because it is a rare, specific message rather than a frequent one.
 *
 * It states the closing DATE and not "in 3 days": the run fires once a day and a posting is reminded somewhere in a
 * 25-hour window (0205), so a relative promise would be wrong for some of them. The date is read in WAT by the shared
 * formatter, like every other date in the app.
 */
export function buildExpiryReminderEmail(args: {
  firstName: string | null;
  title: string;
  /** ISO timestamp the posting closes. */
  closesAt: string;
  /** Absolute URL of the confirm page carrying the raw token. */
  extendUrl: string;
  /** Absolute URL of Jobs Posted, for an employer who wants to edit or close it instead. */
  jobsUrl: string;
}): { subject: string; text: string; html: string } {
  const greeting = args.firstName ? `Hi ${args.firstName},` : "Hi,";
  const closes = formatDate(args.closesAt);

  const subject = `"${args.title}" closes on ${closes}`;
  const line1 = `Your job posting "${args.title}" closes on ${closes}. After that it comes off Talentrah and stops taking applications.`;
  const line2 = `Still hiring? Extend it by ${EXTEND_DAYS} days from that date in one click. Nothing is charged, and if you do nothing the posting simply closes.`;
  const line3 = "You can also edit the closing date, or close the posting yourself, from Jobs Posted.";

  const text = [
    greeting,
    "",
    line1,
    "",
    line2,
    `Extend ${EXTEND_DAYS} days: ${args.extendUrl}`,
    "",
    `${line3} ${args.jobsUrl}`,
    "",
    "— Talentrah",
  ].join("\n");

  const bodyHtml = [
    emailParagraph(escEmail(greeting)),
    emailParagraph(escEmail(line1)),
    emailParagraph(escEmail(line2)),
    emailButton(`Extend ${EXTEND_DAYS} days`, args.extendUrl),
    emailParagraph(`${escEmail(line3)} <a href="${escEmail(args.jobsUrl)}">Jobs Posted</a>`),
    emailParagraph("— Talentrah"),
  ].join("\n");

  return { subject, text, html: renderBrandedEmail({ logo: true, bodyHtml }) };
}
