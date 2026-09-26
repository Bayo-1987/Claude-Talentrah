import { NextResponse } from "next/server";
import { sendAutoApplyDigest } from "@/lib/auto-apply-digest/send";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Weekly Auto-Apply proof-of-work digest trigger (send-463).
 *
 * A separate route and a separate weekly cron entry from send-job-digest,
 * deliberately — these are two independent signals a user should eventually
 * be able to unsubscribe from independently, and combining them into one
 * email template would make that harder later, not easier now. Scheduled at
 * an adjacent Monday slot (vercel.json) rather than inside the match
 * digest's own route.
 *
 * GET  — Vercel Cron (`Authorization: Bearer <CRON_SECRET>`).
 * POST — manual/admin run, matching the other job-runner routes.
 *
 * THE ROUTE DOES NOT CHECK THE FEATURE FLAG — sendAutoApplyDigest does, as
 * its first action, before it reads a single recipient, same reasoning as
 * send-job-digest's own route.
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
    const summary = await sendAutoApplyDigest();
    console.log(`[auto-apply-digest] ${trigger} run:`, JSON.stringify(summary));

    // Same "a disabled feature answers 200, a failed enabled run answers
    // 500" distinction as send-job-digest's own route — see that route's
    // own comment for the full reasoning.
    if (summary.enabled && summary.reason) {
      return NextResponse.json({ summary, error: summary.reason }, { status: 500 });
    }
    return NextResponse.json({ summary });
  } catch (err) {
    return internalError("auto-apply-digest", err);
  }
}
