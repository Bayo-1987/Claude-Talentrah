/**
 * The referral-reward email/in-app copy (send-462) — pure function, no DB,
 * same shape as tests/digest/template.test.ts.
 *
 * The credit amounts come from rewards.ts rather than being hardcoded here, so this test still passes if a future repricing changes
 * them. Since 0215 only ACTIVATION pays (REFERRAL_REWARD_CREDITS); the "signup" reason survives only for events written before 0215
 * (LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS), which the sender can still be asked to notify, so its copy is kept and still tested.
 */
import { describe, expect, it } from "vitest";
import { buildReferralRewardEmail, buildReferralRewardInApp } from "@/lib/notifications/referral-reward/template";
import { LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS, REFERRAL_REWARD_CREDITS } from "@/lib/referrals/rewards";

const REFERRAL_URL = "https://www.talentrah.com/signup?ref=ADA123";

describe("buildReferralRewardEmail", () => {
  it("the signup variant names the moment as a signup, with the real signup bonus amount", () => {
    const { subject, text, html } = buildReferralRewardEmail({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "signup",
      referralUrl: REFERRAL_URL,
    });
    expect(text).toContain("Bola just signed up through your link");
    expect(text).toContain(`${LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS} credits are in your account`);
    expect(subject).toContain(String(LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS));
    expect(html).toContain("Bola just signed up through your link");
  });

  it("the activation variant names the moment as the friend getting set up (a resume saved or a job applied to), with the whole reward", () => {
    const { subject, text, html } = buildReferralRewardEmail({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: REFERRAL_REWARD_CREDITS,
      reason: "activation",
      referralUrl: REFERRAL_URL,
    });
    expect(text).toContain("Bola just got set up on Talentrah");
    expect(text).not.toMatch(/first tailored resume/i); // the old wording: not what "activated" means (a base resume saved, or a job applied to)
    expect(text).toContain(`${REFERRAL_REWARD_CREDITS} credits are in your account`);
    expect(subject).toContain(String(REFERRAL_REWARD_CREDITS));
    expect(html).toContain("Bola just got set up on Talentrah");
  });

  it("the two reason variants produce genuinely distinct copy, not the same string twice", () => {
    const signup = buildReferralRewardEmail({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "signup",
      referralUrl: REFERRAL_URL,
    });
    const activation = buildReferralRewardEmail({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: REFERRAL_REWARD_CREDITS,
      reason: "activation",
      referralUrl: REFERRAL_URL,
    });
    expect(signup.subject).not.toBe(activation.subject);
    expect(signup.text).not.toBe(activation.text);
  });

  it("falls back to 'Someone' when the referred user has no name on file — never blank or literal 'null'", () => {
    const { text } = buildReferralRewardEmail({
      referrerFirstName: "Ada",
      referredFirstName: null,
      creditsGranted: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "signup",
      referralUrl: REFERRAL_URL,
    });
    expect(text).toContain("Someone just signed up through your link");
    expect(text.toLowerCase()).not.toContain("null");
  });

  it("greets without a name rather than printing an empty one", () => {
    const { text } = buildReferralRewardEmail({
      referrerFirstName: null,
      referredFirstName: "Bola",
      creditsGranted: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "signup",
      referralUrl: REFERRAL_URL,
    });
    expect(text).toContain("Hi,");
    expect(text).not.toMatch(/Hi (null|undefined)/);
  });

  it("carries the share link in both the text and the html, and it is absolute", () => {
    const { text, html } = buildReferralRewardEmail({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "signup",
      referralUrl: REFERRAL_URL,
    });
    expect(text).toContain(REFERRAL_URL);
    expect(html).toContain(REFERRAL_URL);
    expect(html).toMatch(/href="https?:\/\/[^"]*\/signup\?ref=/);
  });

  it("always ships a plain-text part alongside the HTML — low-end-Android/expensive-data market", () => {
    const { text, html } = buildReferralRewardEmail({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "signup",
      referralUrl: REFERRAL_URL,
    });
    expect(text.length).toBeGreaterThan(40);
    expect(html).toContain("<html>");
  });

  it("signs off as Farah, and never calls her the AI or a bot", () => {
    const { text } = buildReferralRewardEmail({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "signup",
      referralUrl: REFERRAL_URL,
    });
    expect(text).toContain("— Farah");
    for (const banned of ["the AI", "the bot", "chatbot"]) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("uses 'credit' singular for exactly 1 credit granted", () => {
    const { text } = buildReferralRewardEmail({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: 1,
      reason: "signup",
      referralUrl: REFERRAL_URL,
    });
    expect(text).toMatch(/1 credit\b/);
    expect(text).not.toMatch(/1 credits\b/);
  });
});

describe("buildReferralRewardInApp", () => {
  it("carries the same facts as the email, without a referral URL", () => {
    const inApp = buildReferralRewardInApp({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: REFERRAL_REWARD_CREDITS,
      reason: "activation",
    });
    expect(inApp.body).toContain("Bola just got set up on Talentrah");
    expect(inApp.body).toContain(String(REFERRAL_REWARD_CREDITS));
    expect(inApp.title.toLowerCase()).toContain("activat");
  });

  it("the signup title is distinct from the activation title", () => {
    const signup = buildReferralRewardInApp({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "signup",
    });
    const activation = buildReferralRewardInApp({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: REFERRAL_REWARD_CREDITS,
      reason: "activation",
    });
    expect(signup.title).not.toBe(activation.title);
  });
});
