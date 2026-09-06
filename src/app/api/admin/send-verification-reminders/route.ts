import { NextResponse } from "next/server";
import { sendVerificationReminders } from "@/lib/employer-verification-reminders/send";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Daily trigger for the "still unverified" employer reminder — see
 * src/lib/employer-verification-reminders/send.ts for the full rationale,
 * including why this one has no feature flag unlike send-job-digest.
 *
 * GET  — Vercel Cron (`Authorization: Bearer <CRON_SECRET>`), scheduled in
 *        vercel.json. Daily, not weekly: the run has to catch an org the
 *        moment it crosses 48 hours, and a weekly cadence would answer that
 *        window six days late for most orgs.
 * POST — manual/admin run, matching every other job-runner route.
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
    const summary = await sendVerificationReminders();
    console.log("[verification-reminders] run:", JSON.stringify(summary));

    // A run that read organizations fine but couldn't send (mailer not
    // configured, a query failure) is a real failure worth a 500 — unlike
    // the digest, there's no "feature is off" state here to distinguish
    // from an actual fault.
    if (summary.reason) {
      return NextResponse.json({ summary, error: summary.reason }, { status: 500 });
    }
    return NextResponse.json({ summary });
  } catch (err) {
    return internalError("verification-reminders", err);
  }
}
