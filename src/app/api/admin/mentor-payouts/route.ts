import { NextResponse } from "next/server";
import { runMentorPayoutJob } from "@/lib/mentorship/payouts";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Mentor payouts (0149) — same two-entry-point shape as renew-passes and
 * mentorship-sweep: GET for Vercel Cron, POST for a manual/admin on-demand
 * run, both behind the shared fail-closed secret guard since this route
 * moves REAL money out of Talentrah's own Paystack balance.
 *
 * DAILY, same as this repo's other cron entries — see mentorship-sweep's own
 * comment on why (Hobby-tier Vercel only actually runs a cron once a day
 * regardless of the schedule string). The real consequence: a session that
 * clears its 72-hour hold window right after this cron's daily run waits up
 * to ~24 extra hours for the next one. Acceptable for a payout (unlike a
 * refund, nobody is blocked waiting on it) and not worth a paid-tier cron
 * upgrade on its own.
 *
 * runMentorPayoutJob is safe under Vercel's best-effort/no-retry cron
 * delivery and under a missed day for the same reason runPassRenewalJob is:
 * its work-list query selects on eligible_at/pending_transfer_reference, not
 * "did today's run already happen," so a missed or doubled invocation is
 * picked up (or safely no-ops) on the next one either way.
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
  let summary;
  try {
    summary = await runMentorPayoutJob();
  } catch (err) {
    return internalError("mentor-payouts", err);
  }

  console.log(
    `[mentor-payouts] ${trigger} run: ok=${summary.ok} rowsCreated=${summary.rowsCreated} attempted=${summary.attempted} paid=${summary.paid} indeterminate=${summary.indeterminate} failed=${summary.failed} errors=${summary.errors.length}`,
  );

  return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
}
