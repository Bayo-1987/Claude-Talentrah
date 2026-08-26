import { NextResponse } from "next/server";
import { chargeActiveCampaigns } from "@/lib/billing/campaign-charge";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Daily trigger for the ad-campaign charge. Two ways in, matching ingest-jobs
 * and renew-passes:
 *
 *  GET  — Vercel Cron (`Authorization: Bearer <CRON_SECRET>`), scheduled in
 *         vercel.json.
 *  POST — manual/admin run, `x-admin-secret`. Accepts an optional
 *         `{ organizationId }` so an operator can re-run the charge for one
 *         advertiser after fixing their wallet, rather than for everyone.
 *
 * Cron delivery is best-effort and never retried, which is safe here: the
 * charge is idempotent per campaign per day (`last_charged_on`), so a
 * duplicated run charges nothing twice. A MISSED run is not recovered — that
 * day simply goes unbilled, in the employer's favour. Recording it because it
 * is the same operational shape as 0043's renewal cron: this job is
 * load-bearing, there is no dunning queue and no alert, and a cron that
 * silently stops firing means campaigns run free again.
 */

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  return runAndRespond("cron");
}

export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  let organizationId: string | undefined;
  try {
    const body = (await request.json()) as { organizationId?: string };
    organizationId = body?.organizationId;
  } catch {
    // No body is the normal manual case — charge everything.
  }
  return runAndRespond("manual", organizationId);
}

async function runAndRespond(trigger: "cron" | "manual", organizationId?: string) {
  try {
    const summary = await chargeActiveCampaigns({ organizationId });
    console.log(
      `[campaign-charge] ${trigger} run${organizationId ? ` org=${organizationId}` : ""}: ` +
        `considered=${summary.considered} charged=${summary.charged} ` +
        `already=${summary.alreadyCharged} out-of-funds=${summary.pausedInsufficientFunds} ` +
        `completed=${summary.completed} failed=${summary.failed}`,
    );
    return NextResponse.json(summary);
  } catch (err) {
    return internalError("campaign-charge", err);
  }
}
