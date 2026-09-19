import { absoluteUrl } from "@/lib/seo/site";
import { describeMatchConfidence } from "@/lib/match-tier";
import type { ScoredNewJob } from "./select";
import { EMAIL_COLORS, emailButton, emailHeadline, emailLabel, emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";

/**
 * Farah-voiced, per §6.10's own split (matches/referrals speak as Farah,
 * receipts/B2B stay neutral-system) — same voice as the weekly digest
 * (digest/template.ts), not a new one. First-person, warm, specific, and this
 * is the ONE place §6.10's own worked example line belongs verbatim: "You'll
 * only hear from Farah like this for matches this strong" is what makes the
 * rarity itself part of the message, not just an internal rate limit nobody
 * is told about.
 *
 * Structured like the digest's own email (a line of context, the one job,
 * one action) rather than a chatty paragraph — voice varies BY CHANNEL, and
 * email stays structured even when the sender is personal.
 *
 * send-395 — the HTML below used to hand-code this same palette as its own
 * inline hex literals instead of importing EMAIL_COLORS from layout.ts: not
 * visually wrong (the values matched), but an independent copy that
 * layout.ts's own future changes would silently stop reaching. Now wired
 * onto the same emailParagraph/emailLabel/emailHeadline/emailButton/
 * renderBrandedEmail helpers digest/template.ts and mentorship/
 * notifications.ts already use — same visual result, same copy, just no
 * second palette. The job-info block (score label, title, company/location,
 * inside a bordered box) has no dedicated layout.ts helper of its own
 * either; digest/template.ts's identical block is the precedent this
 * mirrors rather than inventing a new one.
 */

export interface ProactiveAlertEmail {
  subject: string;
  text: string;
  html: string;
}

export interface ProactiveAlertInApp {
  title: string;
  body: string;
  link: string;
}

function greeting(firstName: string | null): string {
  const name = firstName?.trim();
  return name ? `Hi ${name},` : "Hi,";
}

/**
 * `job.score` is never interpolated raw here — `select.ts`'s own
 * `isExcellentMatch` already refuses a thin-denominator match at eligibility
 * time, so this display cap only ever does Stage 12's ordinary 99-ceiling
 * work for a job that reaches this template at all. Routed through the same
 * `describeMatchConfidence` every other render site uses anyway, rather than
 * this file keeping its own copy of `displayMatchScore` — see
 * docs/match-confidence-invariant.md.
 */
function displayScoreFor(job: ScoredNewJob): number {
  return describeMatchConfidence(job.score, job.explanation).displayScore;
}

export function buildProactiveAlertInApp(job: ScoredNewJob): ProactiveAlertInApp {
  return {
    title: "An exceptional match just for you",
    body: `${job.title} at ${job.companyName} is a ${displayScoreFor(job)}% match — worth a look even if you weren't searching.`,
    link: `/jobs/${job.jobId}`,
  };
}

export function buildProactiveAlertEmail(params: {
  firstName: string | null;
  job: ScoredNewJob;
  unsubscribeToken: string;
}): ProactiveAlertEmail {
  const { firstName, job, unsubscribeToken } = params;
  const jobUrl = absoluteUrl(`/jobs/${job.jobId}`);
  const unsubscribeUrl = absoluteUrl(
    `/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}&pref=proactive_match_alert`,
  );
  const where = job.location ? ` · ${job.location}` : "";
  const displayScore = displayScoreFor(job);

  const subject = `An exceptional match: ${job.title} at ${job.companyName}`;

  const text = [
    greeting(firstName),
    "",
    `I know you haven't been actively looking, but this one is too strong to sit on: ` +
      `${job.title} at ${job.companyName}${where} is a ${displayScore}% match against your resume.`,
    "",
    `You'll only hear from me like this for matches this strong.`,
    "",
    `Take a look: ${jobUrl}`,
    "",
    "— Farah",
    "",
    `Don't want these rare alerts? Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  // Same bordered job-info block digest/template.ts's own job rows use —
  // no dedicated layout.ts helper covers this shape (label + headline +
  // muted company/location line inside a top/bottom-bordered box), so this
  // mirrors that file's block rather than inventing a second one.
  const jobInfoBlock = `<div style="padding:16px 0;border-top:1px solid ${EMAIL_COLORS.line};border-bottom:1px solid ${EMAIL_COLORS.line};">
      ${emailLabel(`${escEmail(String(displayScore))}% match`)}
      ${emailHeadline(escEmail(job.title))}
      <div style="font:400 14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:${EMAIL_COLORS.bodyMuted};margin-top:2px;">
        ${escEmail(job.companyName)}${job.location ? ` · ${escEmail(job.location)}` : ""}
      </div>
    </div>`;

  const bodyHtml = [
    emailParagraph(escEmail(greeting(firstName))),
    emailParagraph("I know you haven&rsquo;t been actively looking, but this one is too strong to sit on:"),
    jobInfoBlock,
    emailParagraph("You&rsquo;ll only hear from me like this for matches this strong."),
    emailButton("Take a look", jobUrl),
    emailParagraph("— Farah"),
  ].join("\n");

  const footerHtml = `Don&rsquo;t want these rare alerts? <a href="${escEmail(unsubscribeUrl)}" style="color:${EMAIL_COLORS.accent};">Unsubscribe</a>.`;

  const html = renderBrandedEmail({ bodyHtml, footerHtml });

  return { subject, text, html };
}
