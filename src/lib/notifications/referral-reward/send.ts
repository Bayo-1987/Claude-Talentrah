import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getResendClient } from "@/lib/resend/client";
import { absoluteUrl } from "@/lib/seo/site";
import { buildReferralRewardEmail, buildReferralRewardInApp } from "./template";

/**
 * Fires at the moment a referral reward was actually granted — the missing
 * half of Refer & Earn's loop (send-462). Today a referrer only learns they
 * earned credits by opening their own referral page and noticing the
 * balance changed; this closes that.
 *
 * ── GUARANTEED IN-APP, BEST-EFFORT EMAIL — mentorship/notifications.ts's
 * own pattern, copied exactly ─────────────────────────────────────────────
 *
 * The `user_notifications` row is written unconditionally. The email is
 * genuinely optional: a missing RESEND_API_KEY, a Resend failure, or the
 * referrer having turned off the weekly-email preference must never make
 * this function throw — the credit grant this notification is ABOUT has
 * already committed in Postgres by the time the caller reaches this code
 * (see the outbox in migration 0195), so there is nothing left to roll back.
 *
 * ── WHY THE ABSOLUTE SITE ORIGIN, NOT getReferralUrl/getSiteOrigin ─────────
 *
 * src/lib/referrals/url.ts's getReferralUrl reads x-forwarded-host via
 * next/headers, which only resolves inside an actual page render's request
 * scope (that's how HiredReferralBanner, a Server Component, calls it). This
 * module runs from a cron route with no such render in progress, and needs
 * to be callable directly from a plain test with no request context at all
 * — calling next/headers() here would throw in both places. absoluteUrl
 * (src/lib/seo/site.ts) is what every other cron/background send in this
 * repo already uses for exactly this reason (digest/send.ts's
 * unsubscribeUrlFor, mentorship/notifications.ts's applyUrl) — same
 * canonical origin, same /signup?ref=<code> path getReferralUrl builds, just
 * built without a request in scope.
 *
 * ── THE EMAIL_PREFERENCES GATE — REUSES THE DIGEST'S OWN COLUMN ────────────
 *
 * Deliberately job_match_digest, not a new column: send-462's own task scope
 * says not to invent a per-notification-type toggle here, the way 0131 did
 * for the proactive match alert. Read as "does this person want the
 * occasional Farah-voiced growth email", which this is.
 */

interface SendReferralRewardNotificationParams {
  referrerId: string;
  referredUserId: string;
  creditsGranted: number;
  reason: "signup" | "activation";
}

export async function sendReferralRewardNotification(
  params: SendReferralRewardNotificationParams,
): Promise<void> {
  const { referrerId, referredUserId, creditsGranted, reason } = params;
  const supabase = createServiceRoleClient();

  try {
    const [{ data: referrer, error: referrerError }, { data: referred, error: referredError }] = await Promise.all([
      supabase.from("profiles").select("email, first_name, referral_code").eq("id", referrerId).maybeSingle(),
      supabase.from("profiles").select("first_name").eq("id", referredUserId).maybeSingle(),
    ]);
    if (referrerError) throw referrerError;
    if (referredError) throw referredError;

    if (!referrer?.email) {
      console.error(`[referral-reward-notification] referrer ${referrerId} has no email on file — skipping`);
      return;
    }

    const referralUrl = absoluteUrl(`/signup?ref=${referrer.referral_code}`);
    const referredFirstName = referred?.first_name ?? null;

    const inApp = buildReferralRewardInApp({
      referrerFirstName: referrer.first_name,
      referredFirstName,
      creditsGranted,
      reason,
    });

    const { error: notifError } = await supabase.from("user_notifications").insert({
      user_id: referrerId,
      type: "referral_reward",
      title: inApp.title,
      body: inApp.body,
      link: "/refer",
    });
    // Logged, not fatal — same reasoning mentorship/notifications.ts's own
    // writeInAppNotification gives: an in-app write failing must not also
    // cost the referrer the email attempt below.
    if (notifError) {
      console.error(`[referral-reward-notification] in-app write failed for ${referrerId}:`, notifError.message);
    }

    const { data: preference, error: preferenceError } = await supabase
      .from("email_preferences")
      .select("job_match_digest")
      .eq("user_id", referrerId)
      .maybeSingle();
    if (preferenceError) {
      console.error(`[referral-reward-notification] could not read email preference for ${referrerId}:`, preferenceError.message);
      return;
    }
    if (preference && preference.job_match_digest === false) {
      console.log(`[referral-reward-notification] ${referrerId} has opted out of weekly/growth email — email skipped, in-app notice still written`);
      return;
    }

    const resend = getResendClient();
    if (!resend) {
      console.error("[referral-reward-notification] RESEND_API_KEY is not set — email not sent, in-app notice still written");
      return;
    }

    const email = buildReferralRewardEmail({
      referrerFirstName: referrer.first_name,
      referredFirstName,
      creditsGranted,
      reason,
      referralUrl,
    });

    try {
      await resend.emails.send({
        from: "Farah at Talentrah <farah@talentrah.com>",
        to: referrer.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
    } catch (err) {
      console.error(`[referral-reward-notification] email send failed for ${referrerId}:`, err);
    }
  } catch (err) {
    console.error(`[referral-reward-notification] sendReferralRewardNotification(${referrerId}) failed:`, err);
  }
}
