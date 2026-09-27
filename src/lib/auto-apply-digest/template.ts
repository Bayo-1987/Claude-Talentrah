import { absoluteUrl } from "@/lib/seo/site";
import { emailButton, emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";
import type { AutoApplyDigestSummary } from "./select";

/**
 * The weekly Auto-Apply proof-of-work email — send-463.
 *
 * ── WHY THIS EXISTS: TRUST, NOT MARKETING ───────────────────────────────────
 *
 * Auto-Apply's whole pitch is "review-before-submit by default, a
 * conservative match threshold" (CLAUDE.md's own differentiation thesis) —
 * but a feature that works silently in the background gives a user nothing
 * to notice. This is that noticing, turned into a habit: matter-of-fact,
 * proof-of-work, never salesy. Farah-voiced (this is a report of Farah's own
 * action on the user's behalf), same sender and shell as the match digest.
 *
 * ── THE HONESTY RULE: DISMISSED/EXPIRED ARE STATED, NOT HIDDEN ──────────────
 *
 * A digest that only ever reports good news reads as marketing, not a
 * report — the moment it looks curated, "review-before-submit" stops feeling
 * like a real safety net. So a dismissed or expired count this week is
 * stated as plainly as a submitted one, in the same paragraph.
 *
 * ── PLAIN TEXT AND HTML BOTH, SAME AS THE MATCH DIGEST ──────────────────────
 *
 * This market skews low-end-Android/expensive-data (CLAUDE.md's own
 * non-functional requirement).
 *
 * ── TIER LABELS ARE ALREADY PRE-BUILT BY select.ts ──────────────────────────
 *
 * `summary.highlights[].tier` is `describeMatchConfidence`'s own label
 * string, computed in select.ts — this file only ever prints it verbatim,
 * never re-derives a score or tier itself. See select.ts's own header for
 * why the computation lives there rather than here.
 */

export interface AutoApplyDigestEmail {
  subject: string;
  text: string;
  html: string;
}

function greeting(firstName: string | null): string {
  const name = firstName?.trim();
  return name ? `Hi ${name},` : "Hi,";
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return n === 1 ? singular : pluralForm;
}

/** The lead sentence — what Farah queued this week. Always present; `queued` is only 0 when the caller should not have built an email at all. */
function leadLine(summary: AutoApplyDigestSummary): string {
  const { queued } = summary;
  return `Farah queued ${queued} ${plural(queued, "application")} for your review this week.`;
}

/** The approved/handed-off sentence — omitted entirely when neither happened (e.g. everything is still pending, or the week was all dismissals/expiries). */
function resolvedLine(summary: AutoApplyDigestSummary): string | null {
  const { submitted, handedOff } = summary;
  if (submitted > 0 && handedOff > 0) {
    return `You approved ${submitted}, and Farah handed ${handedOff} off to apply directly.`;
  }
  if (submitted > 0) {
    return `You approved ${submitted}.`;
  }
  if (handedOff > 0) {
    return `Farah handed ${handedOff} off to apply directly.`;
  }
  return null;
}

/** The honest-reporting lines — dismissed/expired, stated plainly, never omitted when they happened. */
function honestyLines(summary: AutoApplyDigestSummary): string[] {
  const lines: string[] = [];
  if (summary.dismissed > 0) {
    const object = summary.dismissed === 1 ? "it" : "them";
    lines.push(`${summary.dismissed} didn't make the cut when you reviewed ${object}.`);
  }
  if (summary.expired > 0) {
    const object = summary.expired === 1 ? "it" : "them";
    lines.push(`${summary.expired} expired before you got to ${object}.`);
  }
  return lines;
}

/** Still sitting in the queue, awaiting review — derived, not a tracked field. */
function stillPendingLine(summary: AutoApplyDigestSummary): string | null {
  const pending = summary.queued - summary.submitted - summary.handedOff - summary.dismissed - summary.expired;
  if (pending <= 0) return null;
  return `${pending} ${plural(pending, "is", "are")} still waiting on your review.`;
}

export function buildAutoApplyDigestEmail(summary: AutoApplyDigestSummary, firstName: string | null): AutoApplyDigestEmail {
  const queueUrl = absoluteUrl("/auto-apply");

  const lines = [leadLine(summary), resolvedLine(summary), ...honestyLines(summary), stillPendingLine(summary)].filter(
    (l): l is string => l !== null,
  );

  const subject = `Farah's Auto-Apply report: ${summary.queued} ${plural(summary.queued, "application")} this week`;

  const highlightLines = summary.highlights.map((h) => `  ${h.tier} — ${h.jobTitle}, ${h.companyName}`);

  const text = [
    greeting(firstName),
    "",
    ...lines,
    ...(highlightLines.length > 0 ? ["", ...highlightLines] : []),
    "",
    `See your queue: ${queueUrl}`,
    "",
    "— Farah",
  ].join("\n");

  const highlightRows = summary.highlights
    .map(
      (h) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #d9cfc2;">
          <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#6b4a3a;">${escEmail(h.tier)}</div>
          <div style="font:500 15px/1.4 Georgia,'Times New Roman',serif;color:#2b2119;">${escEmail(h.jobTitle)}</div>
          <div style="font:400 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#5a4a3f;">${escEmail(h.companyName)}</div>
        </td>
      </tr>`,
    )
    .join("");

  const bodyHtml = [
    emailParagraph(escEmail(greeting(firstName))),
    ...lines.map((l) => emailParagraph(escEmail(l))),
    ...(highlightRows
      ? [`<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border-top:1px solid #d9cfc2;margin-top:8px;">${highlightRows}</table>`]
      : []),
    emailButton("See your queue", queueUrl),
    emailParagraph("— Farah"),
  ].join("\n");

  const html = renderBrandedEmail({ bodyHtml });

  return { subject, text, html };
}
