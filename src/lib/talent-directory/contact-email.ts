import { absoluteUrl } from "@/lib/seo/site";

/**
 * Two emails for the Talent Directory contact flow (send-157), voiced per
 * §6.10's own split exactly the way proactive-match-alert/template.ts and
 * mentorship/template.ts already do for their own pair of audiences:
 *
 *   - To the CANDIDATE, when an employer's interest first arrives: Farah-
 *     voiced. This is relationship-y and an opportunity FOR them, the same
 *     category §6.10 names for matches/referrals.
 *   - To the EMPLOYER, once the candidate approves: neutral system voice.
 *     A factual, B2B notice revealing contact details is a receipt, not a
 *     pitch — the same reasoning mentorship/template.ts gives for its own
 *     booking confirmations.
 *
 * Neither email is gated on an email_preferences column the way the digest
 * and proactive-match-alert are — both are direct, one-off consequences of
 * an action a specific person just took (an employer sending interest, a
 * candidate approving it), not a recurring notification stream someone
 * would want to turn off independently of using the feature at all.
 */

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ContactRequestNoticeEmail {
  subject: string;
  text: string;
  html: string;
}

export function buildContactRequestNoticeEmail(params: {
  firstName: string | null;
  companyName: string;
  message: string;
}): ContactRequestNoticeEmail {
  const { firstName, companyName, message } = params;
  const name = firstName?.trim();
  const greeting = name ? `Hi ${name},` : "Hi,";
  const reviewUrl = absoluteUrl("/talent-directory/verify");

  const subject = `${companyName} is interested in connecting`;

  const text = [
    greeting,
    "",
    `${companyName} found your profile in the Talent Directory and would like to connect. Their note:`,
    "",
    `"${message}"`,
    "",
    `Nothing is shared with them unless you say yes — review it and decide: ${reviewUrl}`,
    "",
    "— Farah",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#fff6ef;">
  <div style="max-width:560px;margin:0 auto;">
    <p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#231715;">
      ${esc(greeting)}
    </p>
    <p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#231715;">
      <strong>${esc(companyName)}</strong> found your profile in the Talent Directory and would like to connect. Their note:
    </p>
    <div style="padding:14px 16px;border-left:3px solid #e3d8d2;font:400 14px/1.6 Georgia,'Times New Roman',serif;font-style:italic;color:#231715;">
      &ldquo;${esc(message)}&rdquo;
    </div>
    <p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#231715;">
      Nothing is shared with them unless you say yes.
    </p>
    <p style="margin:24px 0;">
      <a href="${esc(reviewUrl)}"
         style="display:inline-block;background:#e4512c;color:#ffffff;text-decoration:none;
                border-radius:24px;
                padding:12px 20px;font:600 14px/1 -apple-system,Segoe UI,Roboto,sans-serif;">
        Review and decide
      </a>
    </p>
    <p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#231715;">— Farah</p>
  </div>
</body></html>`;

  return { subject, text, html };
}

export interface ContactApprovedEmail {
  subject: string;
  text: string;
  html: string;
}

export function buildContactApprovedEmail(params: {
  employerFirstName: string | null;
  candidateName: string;
  candidateEmail: string;
}): ContactApprovedEmail {
  const { employerFirstName, candidateName, candidateEmail } = params;
  const name = employerFirstName?.trim();
  const greeting = name ? `Hi ${name},` : "Hi,";

  const subject = `${candidateName} approved your Talent Directory request`;

  const text = [
    greeting,
    "",
    `${candidateName} has agreed to connect with you. You can reach them directly at:`,
    "",
    candidateEmail,
    "",
    "— Talentrah",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#fff6ef;">
  <div style="max-width:560px;margin:0 auto;">
    <p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#231715;">
      ${esc(greeting)}
    </p>
    <p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#231715;">
      <strong>${esc(candidateName)}</strong> has agreed to connect with you. You can reach them directly at:
    </p>
    <p style="font:600 16px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#231715;">
      <a href="mailto:${esc(candidateEmail)}" style="color:#e4512c;">${esc(candidateEmail)}</a>
    </p>
    <p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#231715;">— Talentrah</p>
  </div>
</body></html>`;

  return { subject, text, html };
}
