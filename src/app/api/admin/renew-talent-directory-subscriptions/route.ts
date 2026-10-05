import { NextResponse } from "next/server";
import { lapseEndedTalentDirectorySubscriptions, runTalentDirectorySubscriptionRenewalJob } from "@/lib/talent-directory/renewals";
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

  // After the renewals (a row just extended is no longer ended), lapse the ended ones that are not waiting on a renewal.
  const lapse = await lapseEndedTalentDirectorySubscriptions();
  if (lapse.error) {
    summary.ok = false;
    summary.queryErrors.push({ message: `lapse: ${lapse.error}` });
  }

  console.log(
    `[talent-directory-renewal] renewed=${summary.renewed} lapsed=${summary.lapsed} indeterminate=${summary.indeterminate} errors=${summary.errors.length} lapsedEnded=${lapse.lapsed}`,
  );

  return NextResponse.json({ summary, lapsedEnded: lapse.lapsed }, { status: summary.ok ? 200 : 500 });
}
