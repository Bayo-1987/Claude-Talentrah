import { absoluteUrl } from "@/lib/seo/site";
import { emailButton, emailHeadline, emailLabel, emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";
import type { DeadlineAlertCandidate } from "./select";

/**
 * One scholarship's deadline per email — deliberately not batched.
 *
 * Unlike the weekly job-match digest (digest/template.ts), which exists
 * precisely to gather several matches into one considered read, this is
 * urgency content: a person with three saved scholarships approaching
 * deadlines in the same window gets three separate, unambiguous emails, each
 * about one scholarship, one deadline, one action. Bundling them into a
 * single "3 scholarships closing soon" digest would dilute exactly the
 * specific, actionable fact each one carries — this app already has that
 * failure mode named for it in the job digest's own docs (a thin week padded
 * out is worse than no email); here the equivalent mistake is a single loud
 * fact getting lost among two others.
 *
 * Voice is neutral/informational, not Farah's — this is factual,
 * deadline-driven content closer to renewals.ts's reminder email (a plain
 * fact plus a link) than to the digest's relationship voice. §6.10 splits
 * notifications by sender for exactly this reason: Farah for the
 * relationship-y ones (matches, referrals), a neutral system voice for
 * factual ones.
 *
 * Text part alongside HTML for the same reason digest/template.ts gives:
 * this market skews to low-end Android on expensive data, and a plain-text
 * part is what a constrained client actually renders.
 */

export interface ScholarshipDeadlineEmail {
  subject: string;
  text: string;
  html: string;
}

function greeting(firstName: string | null): string {
  const name = firstName?.trim();
  return name ? `Hi ${name},` : "Hi,";
}

/** Date-only column, built in local-independent UTC parts to avoid an off-by-one near midnight. */
function formatDeadline(deadline: string): string {
  const [y, m, d] = deadline.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function daysOutLabel(daysOut: number): string {
  if (daysOut === 0) return "today";
  if (daysOut === 1) return "tomorrow";
  return `in ${daysOut} days`;
}

export function buildScholarshipDeadlineEmail(params: {
  firstName: string | null;
  candidate: DeadlineAlertCandidate;
  daysOut: number;
  unsubscribeToken: string;
}): ScholarshipDeadlineEmail {
  const { firstName, candidate, daysOut, unsubscribeToken } = params;

  if (candidate.applicationDeadline === null) {
    // selectDeadlineAlertCandidates should never let this through — thrown
    // here rather than silently rendering "null" into an email, matching
    // digest/template.ts's own defend-at-render-time convention.
    throw new Error(
      `buildScholarshipDeadlineEmail: scholarship ${candidate.scholarshipId} has no application_deadline — selectDeadlineAlertCandidates should have excluded it.`,
    );
  }

  const scholarshipUrl = absoluteUrl(`/scholarships/${candidate.scholarshipId}`);
  const unsubscribeUrl = absoluteUrl(
    `/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}&pref=scholarship_deadline_alert`,
  );
  const deadlineText = formatDeadline(candidate.applicationDeadline);
  const whenText = daysOutLabel(daysOut);

  const subject =
    daysOut === 0
      ? `Today's the deadline: ${candidate.programName}`
      : `Closes ${whenText}: ${candidate.programName}`;

  const lead = `Your saved scholarship closes ${whenText} — ${deadlineText}.`;

  const text = [
    greeting(firstName),
    "",
    lead,
    "",
    `${candidate.programName}`,
    `${candidate.provider}`,
    "",
    `See it on Talentrah: ${scholarshipUrl}`,
    `Apply on the official site: ${candidate.officialUrl}`,
    "",
    "— Talentrah",
    "",
    `Don't want these? Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  const bodyHtml = [
    emailParagraph(escEmail(greeting(firstName))),
    emailParagraph(escEmail(lead)),
    emailLabel(escEmail(`Deadline · ${deadlineText}`)),
    emailHeadline(escEmail(candidate.programName)),
    emailParagraph(escEmail(candidate.provider), { muted: true }),
    emailButton("View on Talentrah", scholarshipUrl),
    emailParagraph(
      `Apply on the official source: <a href="${escEmail(candidate.officialUrl)}" style="color:#6b4a3a;">${escEmail(candidate.officialUrl)}</a>`,
      { muted: true },
    ),
    emailParagraph("— Talentrah"),
  ].join("\n");

  const footerHtml = `Don't want these? <a href="${escEmail(unsubscribeUrl)}" style="color:#6b4a3a;">Unsubscribe</a>.`;

  const html = renderBrandedEmail({ bodyHtml, footerHtml });

  return { subject, text, html };
}
