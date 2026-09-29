import { absoluteUrl } from "@/lib/seo/site";
import { describeMatchConfidence } from "@/lib/match-tier";
import type { WinbackEmailContent, WinbackMatchedPosting } from "./select";
import {
  EMAIL_COLORS,
  emailButton,
  emailHeadline,
  emailLabel,
  emailParagraph,
  escEmail,
  renderBrandedEmail,
} from "@/lib/email/layout";

/**
 * send-467's win-back email — Farah-voiced ("I noticed you've been away —
 * here's what you missed"), matching §6.10's own voice rule for
 * relationship-y notifications (the digest, the proactive alert). Explicitly
 * NOT guilt-tripping: this is a welcome back, not a scold about having left.
 * No "we missed you" pressure language, no streak-breaking framing, no
 * implication that the person did something wrong by not visiting — just an
 * honest, warm summary of what changed and an easy way back in.
 *
 * Structured like the digest and the proactive alert (a line of context, the
 * count, up to three examples, one CTA) rather than a chatty paragraph —
 * voice varies BY CHANNEL, and email stays structured even when the sender
 * is personal, matching both of those templates' own precedent.
 */

export interface WinbackEmail {
  subject: string;
  text: string;
  html: string;
}

function greeting(firstName: string | null): string {
  const name = firstName?.trim();
  return name ? `Hi ${name},` : "Hi,";
}

function displayScoreFor(job: WinbackMatchedPosting): number {
  return describeMatchConfidence(job.score, job.explanation).displayScore;
}

function jobLine(job: WinbackMatchedPosting): string {
  const where = job.location ? ` · ${job.location}` : "";
  return `${job.title} at ${job.companyName}${where} — ${displayScoreFor(job)}% match`;
}

function jobBlock(job: WinbackMatchedPosting): string {
  return `<div style="padding:10px 0;border-bottom:1px solid ${EMAIL_COLORS.line};">
      ${emailLabel(`${escEmail(String(displayScoreFor(job)))}% match`)}
      ${emailHeadline(escEmail(job.title))}
      <div style="font:400 14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:${EMAIL_COLORS.bodyMuted};margin-top:2px;">
        ${escEmail(job.companyName)}${job.location ? ` · ${escEmail(job.location)}` : ""}
      </div>
    </div>`;
}

export function buildWinbackEmail(params: {
  firstName: string | null;
  content: WinbackEmailContent;
  unsubscribeToken: string;
}): WinbackEmail {
  const { firstName, content, unsubscribeToken } = params;
  const feedUrl = absoluteUrl("/jobs");
  const unsubscribeUrl = absoluteUrl(
    `/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}&pref=win_back_email`,
  );

  const countLabel = content.totalCount === 1 ? "1 new match" : `${content.totalCount} new matches`;
  const subject = `${countLabel} while you were away`;

  const text = [
    greeting(firstName),
    "",
    `I noticed you've been away for a bit — no worries, life happens. Here's what you missed: ` +
      `${countLabel} since your last visit.`,
    "",
    ...content.examples.map((job) => `• ${jobLine(job)}`),
    "",
    `Take a look: ${feedUrl}`,
    "",
    "— Farah",
    "",
    `Don't want these? Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  const bodyHtml = [
    emailParagraph(escEmail(greeting(firstName))),
    emailParagraph(
      `I noticed you&rsquo;ve been away for a bit &mdash; no worries, life happens. Here&rsquo;s what you missed: ` +
        `<strong>${escEmail(countLabel)}</strong> since your last visit.`,
    ),
    ...content.examples.map(jobBlock),
    emailButton("See your matches", feedUrl),
    emailParagraph("— Farah"),
  ].join("\n");

  const footerHtml = `Don&rsquo;t want these? <a href="${escEmail(unsubscribeUrl)}" style="color:${EMAIL_COLORS.accent};">Unsubscribe</a>.`;

  const html = renderBrandedEmail({ bodyHtml, footerHtml });

  return { subject, text, html };
}
