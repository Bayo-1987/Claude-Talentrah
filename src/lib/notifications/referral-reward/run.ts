import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sendReferralRewardNotification } from "./send";

/**
 * The outbox drain — reads `referral_reward_events` rows migration 0195's
 * `grant_referral_reward` writes on an actual grant, and turns each into a
 * real notification. This is the one new cron send-462 needs: nothing
 * already-scheduled in vercel.json polls a similarly-shaped outbox table
 * (checked before adding this — see 0195's own header).
 *
 * ── CLAIM FIRST, SEND SECOND — mentorship-session-reminders' own pattern ───
 *
 * This route has both a GET (Vercel Cron) and a POST (manual admin trigger)
 * entry point, same as every other cron route here, so two runs CAN overlap
 * in practice. The conditional UPDATE below (`where notified_at is null`) is
 * the guard: only one caller's UPDATE can ever match a still-null row, so a
 * second concurrent run sees zero rows for anything already claimed and does
 * nothing — the same reason a second, overlapping in-app write for the same
 * event would be a real user-facing bug (a referrer seeing the same reward
 * announced twice), not just wasted work.
 *
 * Stamped BEFORE sendReferralRewardNotification runs, not after: that
 * function never throws (see its own header) and its email half is already
 * best-effort, so there is no "retry a failed send next run" property to
 * preserve here the way the digest's digest_last_sent_at has — a second
 * attempt at an already-claimed row would only risk a duplicate in-app
 * notification, never recover a real failure.
 */

export interface ReferralRewardNotificationRunSummary {
  ok: boolean;
  considered: number;
  sent: number;
  failed: number;
}

/** Mirrors digest/send.ts's own MAX_RECIPIENTS_PER_RUN — bounded so one run cannot fan out unboundedly. */
const MAX_EVENTS_PER_RUN = 500;

export async function runReferralRewardNotifications(): Promise<ReferralRewardNotificationRunSummary> {
  const supabase = createServiceRoleClient();
  const summary: ReferralRewardNotificationRunSummary = { ok: true, considered: 0, sent: 0, failed: 0 };

  const { data: pending, error } = await supabase
    .from("referral_reward_events")
    .select("id")
    .is("notified_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_EVENTS_PER_RUN);

  if (error) {
    console.error("[referral-reward-notifications] work-list query failed:", error.message);
    summary.ok = false;
    return summary;
  }

  summary.considered = pending?.length ?? 0;

  for (const row of pending ?? []) {
    try {
      await processEvent(supabase, row.id, summary);
    } catch (err) {
      summary.ok = false;
      summary.failed++;
      console.error(`[referral-reward-notifications] event ${row.id} failed:`, err);
    }
  }

  console.log(`[referral-reward-notifications] considered=${summary.considered} sent=${summary.sent} failed=${summary.failed}`);
  return summary;
}

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

async function processEvent(supabase: ServiceClient, eventId: string, summary: ReferralRewardNotificationRunSummary) {
  const { data: claimed } = await supabase
    .from("referral_reward_events")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", eventId)
    .is("notified_at", null)
    .select("id, referrer_id, referred_user_id, credits_granted, reason")
    .maybeSingle();

  if (!claimed) return; // another concurrent run already claimed this event

  // The referrer's account was deleted (0209 keeps the event, detached): there is nobody to tell. The event is already stamped notified.
  if (claimed.referrer_id === null) return;

  const reason = claimed.reason === "referral_activation_bonus" ? "activation" : "signup";

  await sendReferralRewardNotification({
    referrerId: claimed.referrer_id,
    referredUserId: claimed.referred_user_id,
    creditsGranted: claimed.credits_granted,
    reason,
  });
  summary.sent++;
}
