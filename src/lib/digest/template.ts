import { describeMatchConfidence } from "@/lib/match-tier";
import { absoluteUrl } from "@/lib/seo/site";
import { emailButton, emailHeadline, emailLabel, emailParagraph, renderBrandedEmail } from "@/lib/email/layout";
import type { DigestJob } from "./select";

/**
 * The weekly digest email.
 *
 * ── FARAH'S VOICE, BECAUSE §6.10 SPLITS THEM BY SENDER ────────────────────
 *
 * The build prompt divides notifications by who is speaking: Farah-voiced for
 * the relationship-y ones (matches, referrals), a neutral system voice for
 * factual and B2B ones (receipts, ad milestones). A match digest is squarely
 * the first. She is encouraging, direct and practical — and she is never
 * called "the AI" or "the bot", here or anywhere.
 *
 * Voice also varies BY CHANNEL: in-app terse, email structured, WhatsApp
 * conversational. So this is structured — a short line of context, then the
 * jobs as a scannable list, then one action. Not a chatty paragraph.
 *
 * ── PLAIN TEXT AS WELL AS HTML, AND IT IS NOT A COURTESY ──────────────────
 *
 * This project's market skews to low-end Android on expensive data. A text
 * part is a few hundred bytes and is what a constrained client actually
 * renders; sending HTML alone means some people receive nothing readable.
 *
 * ── THE TIER WORDING IS THE SYSTEM'S, NOT THIS FILE'S ─────────────────────
 *
 * Excellent / Good / Fair — and whether a score gets capped/qualified as a
 * thin match — come from `describeMatchConfidence` (match-tier.ts), the same
 * function `MatchTierBadge` calls for every on-screen render. This file used
 * to build its own `${score}% ${MATCH_TIER_LABEL[tier]}` string directly,
 * which is exactly how a thin-denominator "99% Excellent" (see
 * docs/stage8-match-accuracy.md) could have emailed a real inbox an
 * unqualified score the feed itself no longer shows bare — see
 * docs/match-confidence-invariant.md for the standing rule this now follows.
 * Writing "a great match" here would additionally be a fourth tier in prose,
 * which the design system forbids for the same reason: it would make the
 * score mean different things on different screens.
 */

export interface DigestEmail {
  subject: string;
  text: string;
  html: string;
}

function greeting(firstName: string | null): string {
  const name = firstName?.trim();
  // No name is common and normal — "Hi," reads fine, "Hi null," does not.
  return name ? `Hi ${name},` : "Hi,";
}

/**
 * `describeMatchConfidence`, asserted non-null for a digest job specifically.
 * Every `DigestJob` here already cleared `selectDigestJobs`'s own
 * `MIN_DIGEST_SCORE = 70` filter, so `getDisplayMatchTier`'s 60-floor can
 * never return `null` for one — there is always a real tier word to show.
 * Asserting it here (rather than silently falling back to an empty string)
 * means a future change to that filter that broke this assumption would
 * throw loudly building the email, not print a blank label in someone's inbox.
 */
function confidenceLabel(job: DigestJob): { displayScore: number; label: string } {
  const { displayScore, label } = describeMatchConfidence(job.score, job.explanation);
  if (label === null) {
    throw new Error(
      `buildDigestEmail: job ${job.jobId} scored ${job.score}, below MIN_DIGEST_SCORE's floor — ` +
        `selectDigestJobs should never have let this through.`,
    );
  }
  return { displayScore, label };
}

/** Escapes for HTML text nodes and attribute values alike. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildDigestEmail(params: {
  firstName: string | null;
  jobs: DigestJob[];
  unsubscribeToken: string;
}): DigestEmail {
  const { firstName, jobs, unsubscribeToken } = params;

  /*
   * The caller is expected not to reach here with nothing — selectDigestJobs
   * returns [] to mean "stay silent", and the sender honours that. Throwing
   * rather than rendering an empty digest, because an email that says "no
   * matches this week" is the exact thing the silence rule exists to prevent,
   * and a bug that produced one should be loud.
   */
  if (jobs.length === 0) {
    throw new Error("buildDigestEmail called with no jobs — the sender should have skipped.");
  }

  const feedUrl = absoluteUrl("/jobs");
  const unsubscribeUrl = absoluteUrl(`/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`);

  const count = jobs.length;
  const subject =
    count === 1
      ? "1 new job worth a look this week"
      : `${count} new jobs worth a look this week`;

  const lead =
    `I went through this week's new postings against your resume. ` +
    (count === 1
      ? `One is worth your time:`
      : `${count} are worth your time:`);

  const lines = jobs.map((j) => {
    const where = j.location ? ` · ${j.location}` : "";
    const { displayScore, label } = confidenceLabel(j);
    return `${displayScore}% ${label} — ${j.title}, ${j.companyName}${where}`;
  });

  const text = [
    greeting(firstName),
    "",
    lead,
    "",
    ...lines.map((l) => `  ${l}`),
    "",
    `See them on your feed: ${feedUrl}`,
    "",
    "— Farah",
    "",
    `Don't want these? Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  const rows = jobs
    .map(
      (j) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #d9cfc2;">
          ${emailLabel(`${esc(String(confidenceLabel(j).displayScore))}% · ${esc(confidenceLabel(j).label)}`)}
          ${emailHeadline(esc(j.title))}
          <div style="font:400 14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#5a4a3f;margin-top:2px;">
            ${esc(j.companyName)}${j.location ? ` · ${esc(j.location)}` : ""}
          </div>
        </td>
      </tr>`,
    )
    .join("");

  const bodyHtml = [
    emailParagraph(esc(greeting(firstName))),
    emailParagraph(esc(lead)),
    `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border-top:1px solid #d9cfc2;">${rows}</table>`,
    emailButton("See them on your feed", feedUrl),
    emailParagraph("— Farah"),
  ].join("\n");

  const footerHtml = `Don't want these? <a href="${esc(unsubscribeUrl)}" style="color:#6b4a3a;">Unsubscribe</a>.`;

  const html = renderBrandedEmail({ bodyHtml, footerHtml });

  return { subject, text, html };
}
