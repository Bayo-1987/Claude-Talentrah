/**
 * sendReferralRewardNotification (src/lib/notifications/referral-reward/send.ts)
 * — real database, mocked Resend, same shape as
 * tests/mentorship/confirmation-notifications.test.ts: guaranteed in-app,
 * best-effort email.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import { LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS } from "@/lib/referrals/rewards";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Referral-reward-send test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const sentEmails = vi.hoisted(() => [] as Array<{ to: string; subject: string; text: string }>);
const resendConfigured = vi.hoisted(() => ({ value: true }));
const resendThrows = vi.hoisted(() => ({ value: false }));

vi.mock("@/lib/resend/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resend/client")>()),
  getResendClient: () =>
    resendConfigured.value
      ? {
          emails: {
            send: async (payload: { to: string; subject: string; text: string }) => {
              if (resendThrows.value) throw new Error("mock Resend failure");
              sentEmails.push(payload);
              return { data: { id: "mock" }, error: null };
            },
          },
        }
      : null,
}));

let referrerId: string;
let referrerEmail: string;
let referredId: string;

beforeAll(async () => {
  const referrer = await createTestUser("rr-send-referrer");
  const referred = await createTestUser("rr-send-referred");
  referrerId = referrer.id;
  referrerEmail = referrer.email;
  referredId = referred.id;
  await admin.from("profiles").update({ first_name: "Ada" }).eq("id", referrerId);
  await admin.from("profiles").update({ first_name: "Bola" }).eq("id", referredId);
}, 60_000);

afterAll(async () => {
  await deleteTestUsers([referrerId, referredId]);
}, 60_000);

afterEach(async () => {
  sentEmails.length = 0;
  resendConfigured.value = true;
  resendThrows.value = false;
  await admin.from("user_notifications").delete().eq("type", "referral_reward").eq("user_id", referrerId);
  await admin.from("email_preferences").update({ job_match_digest: true }).eq("user_id", referrerId);
});

describe("sendReferralRewardNotification", () => {
  it("writes a guaranteed in-app notification and sends the email", async () => {
    const { sendReferralRewardNotification } = await import("@/lib/notifications/referral-reward/send");
    await sendReferralRewardNotification({
      referrerId,
      referredUserId: referredId,
      creditsGranted: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "signup",
    });

    const { data } = await admin
      .from("user_notifications")
      .select("user_id, type, link, body")
      .eq("type", "referral_reward")
      .eq("user_id", referrerId);
    expect(data).toHaveLength(1);
    expect(data![0].link).toBe("/refer");
    expect(data![0].body).toContain(String(LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS));

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(referrerEmail);
  });

  it("still writes the in-app notification when Resend throws — email is best-effort, in-app is guaranteed", async () => {
    resendThrows.value = true;
    const { sendReferralRewardNotification } = await import("@/lib/notifications/referral-reward/send");
    await expect(
      sendReferralRewardNotification({
        referrerId,
        referredUserId: referredId,
        creditsGranted: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
        reason: "signup",
      }),
    ).resolves.toBeUndefined();

    const { data } = await admin
      .from("user_notifications")
      .select("user_id")
      .eq("type", "referral_reward")
      .eq("user_id", referrerId);
    expect(data).toHaveLength(1);
  });

  it("still writes the in-app notification when RESEND_API_KEY is not configured", async () => {
    resendConfigured.value = false;
    const { sendReferralRewardNotification } = await import("@/lib/notifications/referral-reward/send");
    await sendReferralRewardNotification({
      referrerId,
      referredUserId: referredId,
      creditsGranted: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "signup",
    });

    expect(sentEmails).toHaveLength(0);
    const { data } = await admin
      .from("user_notifications")
      .select("user_id")
      .eq("type", "referral_reward")
      .eq("user_id", referrerId);
    expect(data).toHaveLength(1);
  });

  it("skips the email (but still writes in-app) when the referrer opted out via email_preferences.job_match_digest", async () => {
    const { error } = await admin.from("email_preferences").update({ job_match_digest: false }).eq("user_id", referrerId);
    if (error) throw error;

    const { sendReferralRewardNotification } = await import("@/lib/notifications/referral-reward/send");
    await sendReferralRewardNotification({
      referrerId,
      referredUserId: referredId,
      creditsGranted: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
      reason: "signup",
    });

    expect(sentEmails).toHaveLength(0);
    const { data } = await admin
      .from("user_notifications")
      .select("user_id")
      .eq("type", "referral_reward")
      .eq("user_id", referrerId);
    expect(data).toHaveLength(1);
  });

  it("never throws — a notification failure must not surface as an error to whatever called it", async () => {
    const { sendReferralRewardNotification } = await import("@/lib/notifications/referral-reward/send");
    await expect(
      sendReferralRewardNotification({
        referrerId: "00000000-0000-0000-0000-000000000000",
        referredUserId: referredId,
        creditsGranted: LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS,
        reason: "signup",
      }),
    ).resolves.toBeUndefined();
  });
});
