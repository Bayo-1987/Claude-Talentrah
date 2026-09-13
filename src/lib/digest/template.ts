import { MATCH_TIER_LABEL } from "@/lib/match-tier";
import { absoluteUrl } from "@/lib/seo/site";
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
 * Excellent / Good / Fair come from MATCH_TIER_LABEL. Writing "a great match"
 * here would be a fourth tier in prose, which the design system forbids
 * precisely because it makes the score mean different things on different
 * screens.
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
    return `${j.score}% ${MATCH_TIER_LABEL[j.tier]} — ${j.title}, ${j.companyName}${where}`;
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

  /*
   * Table-free, inline-styled, no images, no web fonts. Editorial's serif is a
   * Google font and mail clients will not load it, so this asks for a serif
   * stack and accepts what it gets rather than shipping a font nobody renders.
   */
  const rows = jobs
    .map(
      (j) => `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #d9cfc2;">
          <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#6b4a3a;">
            ${esc(String(j.score))}% · ${esc(MATCH_TIER_LABEL[j.tier])}
          </div>
          <div style="font:500 17px/1.35 Georgia,'Times New Roman',serif;color:#2b2119;margin-top:2px;">
            ${esc(j.title)}
          </div>
          <div style="font:400 14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#5a4a3f;margin-top:2px;">
            ${esc(j.companyName)}${j.location ? ` · ${esc(j.location)}` : ""}
          </div>
        </td>
      </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f3ec;">
  <div style="max-width:560px;margin:0 auto;">
    <p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#2b2119;">
      ${esc(greeting(firstName))}
    </p>
    <p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#2b2119;">
      ${esc(lead)}
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border-collapse:collapse;border-top:1px solid #d9cfc2;">
      ${rows}
    </table>
    <p style="margin:24px 0;">
      <a href="${esc(feedUrl)}"
         style="display:inline-block;background:#2b2119;color:#f7f3ec;text-decoration:none;
                padding:12px 20px;font:600 14px/1 -apple-system,Segoe UI,Roboto,sans-serif;">
        See them on your feed
      </a>
    </p>
    <p style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#2b2119;">— Farah</p>
    <p style="font:400 12px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#6b5c50;
              border-top:1px solid #d9cfc2;padding-top:12px;">
      Don't want these? <a href="${esc(unsubscribeUrl)}" style="color:#6b4a3a;">Unsubscribe</a>.
    </p>
  </div>
</body></html>`;

  return { subject, text, html };
}
