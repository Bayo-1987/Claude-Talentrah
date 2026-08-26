import { NextResponse } from "next/server";
import { runCampaignChargeJob, type CampaignChargeOptions } from "@/lib/billing/campaign-charges";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Trigger for the daily ad-campaign charge. Not on any user-facing request
 * path. Same two ways in as the other three job runners:
 *
 *  GET  — Vercel Cron (`Authorization: Bearer <CRON_SECRET>`), scheduled in
 *         vercel.json at 08:00 UTC. That slot is clear of the existing three
 *         (ingest-jobs 05:00, renew-passes 06:00, ingest-scholarships 07:00)
 *         and well clear of the 00:00 UTC date boundary, which matters here:
 *         the job charges for a specific date and Supabase's `current_date` is
 *         UTC, so a run near midnight would be ambiguous about which day it
 *         was paying for. 08:00 UTC is 09:00 WAT — a campaign's state for the
 *         day is settled at the start of the Nigerian business day.
 *  POST — manual/admin on-demand run. Takes `?on=YYYY-MM-DD` to charge a
 *         specific date after a missed run, and `?organization_id=` to
 *         restrict the run to one employer — the recovery shape for a support
 *         incident, where charging everyone else again would be the fix
 *         causing a second incident.
 *
 * THIS ROUTE MOVES REAL MONEY — it debits employer ad wallets. It is gated on
 * the single fail-closed guard in admin-auth.ts from the first commit rather
 * than acquiring one later, and tests/api/contract.test.ts asserts both paths
 * 401 without a secret. The standing rule is that no CI-invoked entry point
 * writes to production ungated.
 *
 * Vercel does not retry a failed cron invocation, and delivery is best-effort.
 * The job is safe under both: `charge_ad_campaign_day` is idempotent on
 * `last_charged_on`, so a duplicate delivery charges nothing twice. A MISSED
 * day, however, is genuinely missed — the next run charges for the next day
 * only, and the skipped day is never billed. That is the deliberate direction
 * to fail in (an employer is never charged for a day we failed to bill on
 * time), but it does mean a cron that silently stops firing is lost revenue,
 * not deferred revenue. Recovering a specific missed day is the POST with
 * `?on=`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  // No scope and no date: the cron must charge every active campaign for today.
  return runAndRespond("cron", {});
}

export async function POST(request: Request) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const on = params.get("on");
  const organizationId = params.get("organization_id");

  if (on !== null && !/^\d{4}-\d{2}-\d{2}$/.test(on)) {
    return NextResponse.json({ error: "on must be a YYYY-MM-DD date" }, { status: 400 });
  }
  if (organizationId !== null && !UUID.test(organizationId)) {
    return NextResponse.json({ error: "organization_id must be a UUID" }, { status: 400 });
  }

  return runAndRespond("manual", {
    ...(on ? { on } : {}),
    ...(organizationId ? { organizationId } : {}),
  });
}

async function runAndRespond(trigger: "cron" | "manual", opts: CampaignChargeOptions) {
  let summary;
  try {
    summary = await runCampaignChargeJob(opts);
  } catch (err) {
    // Only reachable if the job itself throws outside its per-campaign catch —
    // e.g. the service-role client cannot be constructed. A single campaign
    // failing is collected into summary.errors and does not land here.
    return internalError("campaign-charge", err);
  }

  console.log(
    `[campaign-charge] ${trigger} run for ${summary.on}${summary.organizationId ? ` org=${summary.organizationId}` : ""}: ok=${summary.ok} considered=${summary.considered} charged=${summary.charged} (₦${summary.chargedNgn}) paused=${summary.pausedInsufficientFunds} completed=${summary.completed} alreadyCharged=${summary.alreadyCharged} skipped=${summary.skipped} errors=${summary.errors.length} queryErrors=${summary.queryErrors.length}`,
  );

  /*
   * 500 when anything threw or a work-list page failed, so a scheduler alerts.
   * Campaigns that PAUSED are not an error — that is §4's designed outcome and
   * a healthy run can be full of them.
   */
  return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
}
