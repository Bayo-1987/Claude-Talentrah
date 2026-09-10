import { NextResponse } from "next/server";
import { runTalentDirectorySubscriptionRenewalJob } from "@/lib/talent-directory/renewals";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Daily recharge for Talent Directory subscriptions — the org-owned,
 * Pass-shaped analogue of /api/admin/renew-passes. Same two-entry-point
 * shape (GET for Vercel Cron, POST for a manual/admin on-demand run) and the
 * same fail-closed secret guard from the first commit, since this route
 * moves real money.
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
  let summary;
  try {
    summary = await runTalentDirectorySubscriptionRenewalJob();
  } catch (err) {
    return internalError("renew-talent-directory-subscriptions", err);
  }

  console.log(
    `[talent-directory-renewal] renewed=${summary.renewed} lapsed=${summary.lapsed} indeterminate=${summary.indeterminate} errors=${summary.errors.length}`,
  );

  return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
}
