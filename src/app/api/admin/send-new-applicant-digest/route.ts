import { NextResponse } from "next/server";
import { runNewApplicantDigest } from "@/lib/employer/new-applicants/digest";
import { defaultDigestDeps } from "@/lib/employer/new-applicants/deps";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * The daily new-applicant digest for employers (0254), 07:05Z = 08:05 Nigeria for everyone: one email per member per organisation listing the jobs that gained applicants since the last run.
 *
 *  GET  — Vercel Cron, with `Authorization: Bearer <CRON_SECRET>` (schedule in vercel.json).
 *  POST — an on-demand run with the admin secret.
 *
 * The answer is counts only ({ ok, claimed, organisations, emailsSent, emailsFailed, released }): no names, no addresses. A run in which an organisation's emails all failed (its rows were released for
 * tomorrow) answers 500 so the scheduler's failure surface fires. Overlapping runs are safe: the database hands each notification to exactly one run (skip locked).
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  return run();
}

export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;
  return run();
}

async function run() {
  try {
    const summary = await runNewApplicantDigest(defaultDigestDeps());
    return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
  } catch (err) {
    return internalError("new-applicant-digest", err);
  }
}
