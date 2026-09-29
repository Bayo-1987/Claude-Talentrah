/**
 * The referral-reward email/in-app copy (send-462) — pure function, no DB,
 * same shape as tests/digest/template.test.ts.
 *
 * The real credit amounts (REFERRAL_SIGNUP_BONUS_CREDITS,
 * REFERRAL_ACTIVATION_BONUS_CREDITS) are imported from rewards.ts rather
 * than hardcoded as 10/40 here, so this test still passes if a future
 * repricing changes them — the same discipline
 * tests/referrals/referrals.test.ts already applies.
 */
import { describe, expect, it } from "vitest";
import { buildReferralRewardEmail, buildReferralRewardInApp } from "@/lib/notifications/referral-reward/template";
import { REFERRAL_SIGNUP_BONUS_CREDITS, REFERRAL_ACTIVATION_BONUS_CREDITS } from "@/lib/referrals/rewards";

const REFERRAL_URL = "https://www.talentrah.com/signup?ref=ADA123";

describe("buildReferralRewardEmail", () => {
  it("the signup variant names the moment as a signup, with the real signup bonus amount", () => {
    const { subject, text, html } = buildReferralRewardEmail({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "signup",
      referralUrl: REFERRAL_URL,
    });
    expect(text).toContain("Bola just signed up through your link");
    expect(text).toContain(`${REFERRAL_SIGNUP_BONUS_CREDITS} credits are in your account`);
    expect(subject).toContain(String(REFERRAL_SIGNUP_BONUS_CREDITS));
    expect(html).toContain("Bola just signed up through your link");
  });

  it("the activation variant names the moment as a first tailored resume, with the real activation bonus amount", () => {
    const { subject, text, html } = buildReferralRewardEmail({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: REFERRAL_ACTIVATION_BONUS_CREDITS,
      reason: "activation",
      referralUrl: REFERRAL_URL,
    });
    expect(text).toContain("Bola just got their first tailored resume");
    expect(text).toContain(`${REFERRAL_ACTIVATION_BONUS_CREDITS} credits are in your account`);
    expect(subject).toContain(String(REFERRAL_ACTIVATION_BONUS_CREDITS));
    expect(html).toContain("Bola just got their first tailored resume");
  });

  it("the two reason variants produce genuinely distinct copy, not the same string twice", () => {
    const signup = buildReferralRewardEmail({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "signup",
      referralUrl: REFERRAL_URL,
    });
    const activation = buildReferralRewardEmail({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: REFERRAL_ACTIVATION_BONUS_CREDITS,
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
      creditsGranted: REFERRAL_SIGNUP_BONUS_CREDITS,
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
      creditsGranted: REFERRAL_SIGNUP_BONUS_CREDITS,
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
      creditsGranted: REFERRAL_SIGNUP_BONUS_CREDITS,
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
      creditsGranted: REFERRAL_SIGNUP_BONUS_CREDITS,
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
      creditsGranted: REFERRAL_SIGNUP_BONUS_CREDITS,
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
      creditsGranted: REFERRAL_ACTIVATION_BONUS_CREDITS,
      reason: "activation",
    });
    expect(inApp.body).toContain("Bola just got their first tailored resume");
    expect(inApp.body).toContain(String(REFERRAL_ACTIVATION_BONUS_CREDITS));
    expect(inApp.title.toLowerCase()).toContain("activat");
  });

  it("the signup title is distinct from the activation title", () => {
    const signup = buildReferralRewardInApp({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "signup",
    });
    const activation = buildReferralRewardInApp({
      referrerFirstName: "Ada",
      referredFirstName: "Bola",
      creditsGranted: REFERRAL_ACTIVATION_BONUS_CREDITS,
      reason: "activation",
    });
    expect(signup.title).not.toBe(activation.title);
  });
});
