import { emailButton, emailParagraph, escEmail, renderBrandedEmail } from "@/lib/email/layout";

/**
 * The reward-grant email — send-462.
 *
 * ── FARAH-VOICED, ONE SHORT NUDGE, NOT A REPORT ────────────────────────────
 *
 * build-prompt §6.10 lists referral conversion as Farah-voiced (relationship-
 * adjacent), contrasting billing@talentrah.com's neutral voice
 * (src/lib/billing/renewals.ts). This is the moment a referral turned into
 * real credits — a celebratory nudge that closes the loop and asks for the
 * next share, not a transactional receipt. Kept to one paragraph plus a CTA
 * on purpose: the digest earns a longer read by being weekly and full of
 * jobs; this fires per-event and has exactly one thing to say.
 *
 * ── WHY TWO COPY VARIANTS, NOT ONE GENERIC "YOU EARNED CREDITS" LINE ───────
 *
 * Since 0215 only ACTIVATION pays, and the activation email carries the whole reward (REFERRAL_REWARD_CREDITS). "Activated" means the
 * friend saved a resume or applied to a job (check_and_activate_referral), so the moment line says they got set up: it used to say "first
 * tailored resume", which is not what the database checks. The "signup" variant survives only for reward events written before 0215,
 * which the sender can still notify.
 *
 * ── PLAIN TEXT AND HTML BOTH, SAME AS THE DIGEST ────────────────────────────
 *
 * This market skews low-end-Android/expensive-data (CLAUDE.md's own
 * non-functional requirement) — a plain-text part is a few hundred bytes and
 * is what a constrained client actually renders.
 *
 * ── THE REAL CREDIT AMOUNTS, NEVER A PLACEHOLDER ────────────────────────────
 *
 * `creditsGranted` is passed in by the caller (send.ts), read straight off
 * `referral_reward_events.credits_granted` — the actual amount
 * `grant_referral_reward` granted (the remainder, for a referral that was
 * part-paid before 0215), not a re-derivation of REFERRAL_REWARD_CREDITS here.
 * That constant exists to keep the TRIGGER's hard-coded literal honest against a
 * future repricing (rewards.ts's own header); this template has no reason to
 * duplicate that number when the event row already has the real one.
 */

export interface ReferralRewardEmailParams {
  referrerFirstName: string | null;
  referredFirstName: string | null;
  creditsGranted: number;
  reason: "signup" | "activation";
  referralUrl: string;
}

export interface ReferralRewardEmail {
  subject: string;
  text: string;
  html: string;
}

function greeting(firstName: string | null): string {
  const name = firstName?.trim();
  return name ? `Hi ${name},` : "Hi,";
}

/** "Someone" when the referred user has no name on file — never a blank or "null". */
function referredName(firstName: string | null): string {
  return firstName?.trim() || "Someone";
}

function momentLine(referredFirstName: string | null, reason: "signup" | "activation"): string {
  const name = referredName(referredFirstName);
  return reason === "signup"
    ? `${name} just signed up through your link`
    : `${name} just got set up on Talentrah`;
}

export function buildReferralRewardEmail(params: ReferralRewardEmailParams): ReferralRewardEmail {
  const { referrerFirstName, referredFirstName, creditsGranted, reason, referralUrl } = params;

  const moment = momentLine(referredFirstName, reason);
  const creditsWord = creditsGranted === 1 ? "credit" : "credits";
  const headline = `${moment} — ${creditsGranted} ${creditsWord} are in your account.`;

  const subject =
    reason === "signup"
      ? `${referredName(referredFirstName)} signed up — ${creditsGranted} credits for you`
      : `${referredName(referredFirstName)} just activated — ${creditsGranted} credits for you`;

  const text = [
    greeting(referrerFirstName),
    "",
    headline,
    "",
    "Know anyone else job hunting? Share your link:",
    referralUrl,
    "",
    "— Farah",
  ].join("\n");

  const bodyHtml = [
    emailParagraph(escEmail(greeting(referrerFirstName))),
    emailParagraph(escEmail(headline)),
    emailParagraph("Know anyone else job hunting?"),
    emailButton("Share your link", referralUrl),
    emailParagraph("— Farah"),
  ].join("\n");

  const html = renderBrandedEmail({ bodyHtml });

  return { subject, text, html };
}

/** Plain, short in-app copy — same underlying facts as the email, no CTA button (the notification row's own `link` field carries that). */
export function buildReferralRewardInApp(params: Omit<ReferralRewardEmailParams, "referralUrl">): {
  title: string;
  body: string;
} {
  const { referredFirstName, creditsGranted, reason } = params;
  const creditsWord = creditsGranted === 1 ? "credit" : "credits";
  return {
    title: reason === "signup" ? "Your referral signed up" : "Your referral activated",
    body: `${momentLine(referredFirstName, reason)} — ${creditsGranted} ${creditsWord} are in your account. Know anyone else job hunting?`,
  };
}
