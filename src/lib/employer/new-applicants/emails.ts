import { emailButton, emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/** The footers (owner-approved wording, 13 Oct). Both link to the Jobs Posted page, where the setting lives; no clock time or timezone. */
export const INSTANT_FOOTER_SENTENCE = "You get a quick alert for the first new applicant on each job, then a daily summary.";
export const INSTANT_FOOTER_LINK_TEXT = "Change this in your jobs settings";
export const DIGEST_FOOTER_SENTENCE = "The daily summary lists names and counts, never contact details.";
export const DIGEST_FOOTER_LINK_TEXT = "Change how often we email you";

/** The most names listed for one job in a digest; the rest are "and N more". */
export const DIGEST_NAMES_PER_JOB = 10;

/**
 * The instant email for a job's first new applicant: the applicant's name, the job and a link to the applicants page, and a pointer to where the frequency is changed. Nothing else is an input, so
 * nothing else can leak into it: no email address, phone, match score or resume content.
 */
export function buildInstantEmail({
  applicantName,
  jobTitle,
  applicantsUrl,
  settingsUrl,
}: {
  applicantName: string;
  jobTitle: string;
  applicantsUrl: string;
  settingsUrl: string;
}): BuiltEmail {
  const who = applicantName.trim() || "A new applicant";
  const subject = `New applicant for ${jobTitle}`;
  const text = `${who} applied for ${jobTitle}.\n\nSee the applicant: ${applicantsUrl}\n\n${INSTANT_FOOTER_SENTENCE} ${INSTANT_FOOTER_LINK_TEXT}: ${settingsUrl}\n\n— Talentrah`;
  const html = renderBrandedEmail({
    bodyHtml: [
      emailParagraph(`${escEmail(who)} applied for ${escEmail(jobTitle)}.`),
      emailButton("See the applicant", applicantsUrl),
    ].join("\n"),
    footerHtml: `${INSTANT_FOOTER_SENTENCE} <a href="${escEmail(settingsUrl)}">${INSTANT_FOOTER_LINK_TEXT}</a>`,
  });
  return { subject, text, html };
}

export interface DigestGroup {
  jobTitle: string;
  jobId: string;
  names: string[];
  count: number;
  applicantsUrl: string;
}

/** The daily digest: every job with new applicants, how many, their names (first ten) and a link per job. */
export function buildDigestEmail({ groups, settingsUrl }: { groups: DigestGroup[]; settingsUrl: string }): BuiltEmail {
  const total = groups.reduce((sum, g) => sum + g.count, 0);
  const subject = `${total} new applicant${total === 1 ? "" : "s"} on Talentrah`;

  const listed = (g: DigestGroup) => {
    const shown = g.names.slice(0, DIGEST_NAMES_PER_JOB);
    const more = g.count - shown.length;
    return `${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""}`;
  };

  const text = [
    ...groups.map((g) => `${g.jobTitle}: ${g.count} new (${listed(g)})\n${g.applicantsUrl}`),
    `${DIGEST_FOOTER_SENTENCE} ${DIGEST_FOOTER_LINK_TEXT}: ${settingsUrl}`,
    "— Talentrah",
  ].join("\n\n");

  const html = renderBrandedEmail({
    bodyHtml: groups
      .map((g) => emailParagraph(`<strong>${escEmail(g.jobTitle)}</strong>: ${g.count} new (${escEmail(listed(g))})<br /><a href="${escEmail(g.applicantsUrl)}">See the applicants</a>`))
      .join("\n"),
    footerHtml: `${DIGEST_FOOTER_SENTENCE} <a href="${escEmail(settingsUrl)}">${DIGEST_FOOTER_LINK_TEXT}</a>`,
  });
  return { subject, text, html };
}
