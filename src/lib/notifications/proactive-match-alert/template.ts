import { absoluteUrl } from "@/lib/seo/site";
import type { ScoredNewJob } from "./select";

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

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildProactiveAlertInApp(job: ScoredNewJob): ProactiveAlertInApp {
  return {
    title: "An exceptional match just for you",
    body: `${job.title} at ${job.companyName} is a ${job.score}% match — worth a look even if you weren't searching.`,
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

  const subject = `An exceptional match: ${job.title} at ${job.companyName}`;

  const text = [
    greeting(firstName),
    "",
    `I know you haven't been actively looking, but this one is too strong to sit on: ` +
      `${job.title} at ${job.companyName}${where} is a ${job.score}% match against your resume.`,
    "",
    `You'll only hear from me like this for matches this strong.`,
    "",
    `Take a look: ${jobUrl}`,
    "",
    "— Farah",
    "",
    `Don't want these rare alerts? Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#fff6ef;">
  <div style="max-width:560px;margin:0 auto;">
    <p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#231715;">
      ${esc(greeting(firstName))}
    </p>
    <p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#231715;">
      I know you haven&rsquo;t been actively looking, but this one is too strong to sit on:
    </p>
    <div style="padding:16px 0;border-top:1px solid #e3d8d2;border-bottom:1px solid #e3d8d2;">
      <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#e4512c;">
        ${esc(String(job.score))}% match
      </div>
      <div style="font:500 17px/1.35 Georgia,'Times New Roman',serif;color:#231715;margin-top:2px;">
        ${esc(job.title)}
      </div>
      <div style="font:400 14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#584947;margin-top:2px;">
        ${esc(job.companyName)}${job.location ? ` · ${esc(job.location)}` : ""}
      </div>
    </div>
    <p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#231715;">
      You&rsquo;ll only hear from me like this for matches this strong.
    </p>
    <p style="margin:24px 0;">
      <a href="${esc(jobUrl)}"
         style="display:inline-block;background:#e4512c;color:#ffffff;text-decoration:none;
                border-radius:24px;
                padding:12px 20px;font:600 14px/1 -apple-system,Segoe UI,Roboto,sans-serif;">
        Take a look
      </a>
    </p>
    <p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#231715;">— Farah</p>
    <p style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#584947;
              border-top:1px solid #e3d8d2;padding-top:12px;">
      Don&rsquo;t want these rare alerts? <a href="${esc(unsubscribeUrl)}" style="color:#e4512c;">Unsubscribe</a>.
    </p>
  </div>
</body></html>`;

  return { subject, text, html };
}
