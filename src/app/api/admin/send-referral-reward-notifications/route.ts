import { NextResponse } from "next/server";
import { runReferralRewardNotifications } from "@/lib/notifications/referral-reward/run";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Referral-reward outbox drain trigger (send-462).
 *
 * GET  — Vercel Cron (`Authorization: Bearer <CRON_SECRET>`), scheduled in
 *        vercel.json. Not time-critical — a referrer learning about a reward
 *        up to a day late is a fine trade against one more hourly cron slot,
 *        unlike a same-session UI push.
 * POST — manual/admin run, matching the other job-runner routes.
 */

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  return runAndRespond("cron");
}

export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;
  return runAndRespond("manual");
}

async function runAndRespond(trigger: "cron" | "manual") {
  try {
    const summary = await runReferralRewardNotifications();
    console.log(`[referral-reward-notifications] ${trigger} run:`, JSON.stringify(summary));
    if (!summary.ok) {
      return NextResponse.json({ summary, error: "work-list query failed" }, { status: 500 });
    }
    return NextResponse.json({ summary });
  } catch (err) {
    return internalError("referral-reward-notifications", err);
  }
}
