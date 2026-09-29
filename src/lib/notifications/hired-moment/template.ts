import { absoluteUrl } from "@/lib/seo/site";
import { emailButton, emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";

/**
 * send-465 — the "you got hired" email, the second channel for the exact
 * moment `HiredReferralBanner` (src/components/tracker/hired-referral-banner.tsx)
 * already covers in-app.
 *
 * Farah-voiced, per §6.10: a hired moment is relationship-y/celebratory, not
 * a neutral B2B receipt — same category as a match or a referral, not a
 * booking confirmation. Deliberately does NOT reuse the banner's own exact
 * sentence ("Congratulations on {jobTitle} — that's huge...") — CLAUDE.md's
 * content rule against repeating the same sentence verbatim in two places —
 * but matches its warmth and its single clear referral ask, as the same
 * voice continuing on a second surface.
 *
 * Kept deliberately short: two or three short paragraphs. This is a
 * celebration, not a report — it doesn't need a full case for why referring
 * a friend or booking a mentor session is a good idea, just the two asks.
 */

export interface HiredMomentEmailParams {
  firstName: string | null;
  jobTitle: string;
  companyName: string;
  referralUrl: string;
}

export interface HiredMomentEmail {
  subject: string;
  text: string;
  html: string;
}

function greeting(firstName: string | null): string {
  const name = firstName?.trim();
  return name ? `Hi ${name},` : "Hi,";
}

export function buildHiredMomentEmail({
  firstName,
  jobTitle,
  companyName,
  referralUrl,
}: HiredMomentEmailParams): HiredMomentEmail {
  const mentorshipUrl = absoluteUrl("/mentorship");
  const subject = `You got the ${jobTitle} role — congratulations!`;

  const text = [
    `${greeting(firstName)}`,
    "",
    `Huge news — you're hired as ${jobTitle} at ${companyName}. Well done. This is exactly what Talentrah is for, and it's a genuine pleasure to see it happen.`,
    "",
    `If you know someone else on the hunt, now's the moment to send them your link — a fresh success story is the best introduction there is: ${referralUrl}`,
    "",
    `And if there's an offer to negotiate, a mentor session can help you walk in prepared: ${mentorshipUrl}`,
    "",
    "— Farah",
  ].join("\n");

  const bodyHtml = [
    emailParagraph(escEmail(greeting(firstName))),
    emailParagraph(
      `Huge news &mdash; you&rsquo;re hired as <strong>${escEmail(jobTitle)}</strong> at <strong>${escEmail(companyName)}</strong>. Well done. This is exactly what Talentrah is for, and it&rsquo;s a genuine pleasure to see it happen.`,
    ),
    emailParagraph(
      "If you know someone else on the hunt, now&rsquo;s the moment to send them your link &mdash; a fresh success story is the best introduction there is.",
    ),
    emailButton("Share your referral link", referralUrl),
    emailParagraph(
      "And if there&rsquo;s an offer to negotiate, a mentor session can help you walk in prepared.",
      { muted: true },
    ),
    emailButton("Find a mentor", mentorshipUrl),
    emailParagraph("&mdash; Farah"),
  ].join("\n");

  const html = renderBrandedEmail({ logo: true, bodyHtml });

  return { subject, text, html };
}
