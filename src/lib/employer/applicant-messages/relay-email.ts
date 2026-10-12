import { absoluteUrl } from "@/lib/seo/site";
import { emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";

export interface RelayEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * The email a candidate receives when an employer messages them through Talentrah. The employer's words are PLAIN TEXT: they are escaped, never rendered as markup,
 * and a link they type stays text (nothing here makes an anchor from the body), so a message cannot dress itself up as a Talentrah notice. Talentrah's own footer says who
 * sent it, where a reply goes and how to report it. The candidate's address never reaches this function, and the employer's address is the Reply-To the sender sets, not part of the body.
 */
export function buildRelayEmail({ orgName, subject, body }: { orgName: string; subject: string; body: string }): RelayEmail {
  const contactUrl = absoluteUrl("/contact");
  const footerText = `Sent by Talentrah on behalf of ${orgName}. Reply to this email to answer ${orgName} directly: your reply goes to them, not to Talentrah.\nIf this message is unwelcome, tell us: ${contactUrl}`;
  const text = `${body}\n\n—\n${footerText}`;

  const paragraphs = body
    .split(/\n{2,}/)
    .map((paragraph) => emailParagraph(escEmail(paragraph).replace(/\n/g, "<br />")));
  // renderBrandedEmail wraps the footer in its own muted, divided <p>.
  const footerHtml =
    `Sent by Talentrah on behalf of ${escEmail(orgName)}. Reply to this email to answer ${escEmail(orgName)} directly: your reply goes to them, not to Talentrah.<br />If this message is unwelcome, <a href="${escEmail(contactUrl)}">tell us</a>.`;
  const html = renderBrandedEmail({ bodyHtml: paragraphs.join("\n"), footerHtml });
  return { subject, text, html };
}
