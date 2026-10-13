import { emailButton, emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

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
  const text = `${who} applied for ${jobTitle}.\n\nSee the applicant: ${applicantsUrl}\n\nChoose how often you hear about new applicants (instant, daily digest or off) on your Jobs Posted page: ${settingsUrl}\n\n— Talentrah`;
  const html = renderBrandedEmail({
    bodyHtml: [
      emailParagraph(`${escEmail(who)} applied for ${escEmail(jobTitle)}.`),
      emailButton("See the applicant", applicantsUrl),
    ].join("\n"),
    footerHtml: `Choose how often you hear about new applicants (instant, daily digest or off) on your <a href="${escEmail(settingsUrl)}">Jobs Posted</a> page.`,
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
    `Choose how often you hear about new applicants (instant, daily digest or off) on your Jobs Posted page: ${settingsUrl}`,
    "— Talentrah",
  ].join("\n\n");

  const html = renderBrandedEmail({
    bodyHtml: groups
      .map((g) => emailParagraph(`<strong>${escEmail(g.jobTitle)}</strong>: ${g.count} new (${escEmail(listed(g))})<br /><a href="${escEmail(g.applicantsUrl)}">See the applicants</a>`))
      .join("\n"),
    footerHtml: `Choose how often you hear about new applicants (instant, daily digest or off) on your <a href="${escEmail(settingsUrl)}">Jobs Posted</a> page.`,
  });
  return { subject, text, html };
}
