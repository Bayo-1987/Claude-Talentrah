import { emailButton, emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";

/**
 * The two emails an admin-produced data export sends to the account owner, in the neutral system voice (a security step about the account, not Farah's).
 *
 *   - the NOTICE, when support STARTS an export, before a single table is read. It says what is happening and what to do if it was not them. It names NO data and carries NO link: an email
 *     is the least private place a person's data could end up.
 *   - the LINK, when the file is ready. A separate, short email: the link, that it works once, only while signed in as this account, and until when. It names no data either.
 *
 * Both go through the deletion-lifecycle door (src/lib/account-deletion/export-email.ts), so a person inside the 30 days before a deletion still receives them: asking to leave does not end
 * the right to a copy, and the owner's rule is that the account owner is told every time.
 */

export interface EmailMessage {
  subject: string;
  text: string;
  html: string;
}

function greeting(firstName: string | null): string {
  const name = firstName?.trim();
  return name ? `Hi ${name},` : "Hi,";
}

function assemble(subject: string, firstName: string | null, lines: string[], button?: { label: string; url: string }): EmailMessage {
  const text = [greeting(firstName), "", ...lines.flatMap((l) => [l, ""]), ...(button ? [button.url, ""] : []), "Talentrah"].join("\n");
  const bodyHtml = [
    emailParagraph(escEmail(greeting(firstName))),
    ...lines.map((l) => emailParagraph(escEmail(l))),
    ...(button ? [emailButton(button.label, button.url)] : []),
    emailParagraph("Talentrah", { muted: true }),
  ].join("\n");
  return { subject, text, html: renderBrandedEmail({ bodyHtml }) };
}

const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function buildStartNoticeEmail({ firstName, startedAt, supportUrl }: { firstName: string | null; startedAt: Date; supportUrl: string }): EmailMessage {
  return assemble("Talentrah support is preparing a copy of your data", firstName, [
    `On ${utc(startedAt)} Talentrah support started preparing a copy of your Talentrah data. We do this when you ask support for it.`,
    "Nothing has been sent yet. When the copy is ready we will email you a link that works only while you are signed in to this account.",
    `If you did not ask for this, change your password now and contact us: ${supportUrl}`,
  ]);
}

export function buildLinkEmail({ firstName, link, expiresAt, supportUrl }: { firstName: string | null; link: string; expiresAt: Date; supportUrl: string }): EmailMessage {
  return assemble(
    "Your copy of your Talentrah data is ready",
    firstName,
    [
      `Your copy is ready. Open the link below while you are signed in to your Talentrah account. It works once, only for this account, and until ${utc(expiresAt)}. The file is deleted as soon as you have downloaded it, or when the link expires.`,
      `If you did not ask for this, ignore this email and contact us: ${supportUrl}`,
    ],
    { label: "Download my data", url: link },
  );
}
