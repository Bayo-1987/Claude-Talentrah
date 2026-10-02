import { NextResponse } from "next/server";
import { sendExpiryReminders } from "@/lib/jobs/expiry-reminders/send";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Daily trigger for the "your posting closes soon" reminder (EMP-1 / E3) — see
 * src/lib/jobs/expiry-reminders/send.ts for the claim-then-send design and migration 0207 for the window.
 *
 * GET  — Vercel Cron (`Authorization: Bearer <CRON_SECRET>`), scheduled in vercel.json. Daily is what the 25-hour
 *        window assumes: every posting's closing time falls inside at least one daily run's window.
 * POST — manual/admin run, matching every other job-runner route. Safe to run any number of times: the claim row makes
 *        a second run on the same day a no-op for every posting already reminded.
 */

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  return runAndRespond();
}

export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;
  return runAndRespond();
}

async function runAndRespond() {
  try {
    const summary = await sendExpiryReminders();
    console.log("[expiry-reminders] run:", JSON.stringify(summary));
    if (summary.reason) {
      return NextResponse.json({ summary, error: summary.reason }, { status: 500 });
    }
    return NextResponse.json({ summary });
  } catch (err) {
    return internalError("expiry-reminders", err);
  }
}
