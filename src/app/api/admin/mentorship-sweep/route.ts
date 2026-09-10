import { NextResponse } from "next/server";
import { runMentorshipSweep } from "@/lib/mentorship/sweep";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Enforces 0133's no-show / cancellation policy: a mentor who hasn't
 * confirmed a session within 24 hours of its scheduled start is
 * auto-cancelled, and a paid session is refunded. Same two-entry-point shape
 * as charge-campaigns and renew-passes — GET for Vercel Cron, POST for a
 * manual/admin on-demand run — and the same fail-closed secret guard from
 * the first commit, since this route moves real money (refunds).
 *
 * RUNS DAILY, same as every other job in vercel.json — an honest compromise,
 * not an oversight: this repo's other six cron entries are all once-a-day,
 * consistent with a Hobby-tier Vercel plan (which only runs a cron once per
 * day regardless of the schedule string), so scheduling this hourly would
 * either be silently downgraded or rejected at deploy time. The real
 * consequence, stated rather than hidden: a session that becomes overdue
 * right after this cron's daily run can sit unconfirmed for up to ~24 extra
 * hours before the NEXT run catches it — the 24-hour deadline in the policy
 * and the ~24-hour cron cadence compound, so worst case is closer to 48
 * hours end to end. Move to a paid plan's minute-level cron (or a
 * dedicated queue) if that gap turns out to matter in practice.
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
    summary = await runMentorshipSweep();
  } catch (err) {
    return internalError("mentorship-sweep", err);
  }

  console.log(
    `[mentorship-sweep] considered=${summary.considered} cancelled=${summary.cancelled} refunded=${summary.refunded} refundFailed=${summary.refundFailed} errors=${summary.errors.length}`,
  );

  return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
}
