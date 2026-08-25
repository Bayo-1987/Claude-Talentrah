import { NextResponse } from "next/server";
import { runPassRenewalJob } from "@/lib/billing/renewals";
import { requireAdminSecret, requireCronSecret, internalError } from "@/lib/api/admin-auth";

/**
 * Trigger for the Pass auto-renewal job. Not on any user-facing request path.
 * Two ways in:
 *
 *  GET  — Vercel Cron, verified against Vercel's docs rather than assumed:
 *         Vercel triggers a cron by making an HTTP *GET* to the production
 *         deployment, and when CRON_SECRET is set it sends that value as
 *         `Authorization: Bearer <secret>`. Header and env var names are both
 *         fixed by Vercel. Schedule lives in vercel.json.
 *  POST — manual/admin on-demand run.
 *
 * THE POST PATH SPENDS REAL MONEY — it charges saved Paystack tokens. It used
 * to be gated on `PASS_RENEWAL_SECRET`, a fourth env var that nothing else in
 * the codebase used and that .env.example did not document, and it was
 * fail-open: unset variable meant no check at all. Of the five admin routes,
 * the one that moves money was the one most likely to be left open by an
 * operator who had configured the documented secret. It now shares the single
 * fail-closed guard in admin-auth.ts with everything else.
 *
 * Vercel does not retry a failed cron invocation, and cron delivery is
 * best-effort. runPassRenewalJob is safe under both: it selects on
 * `next_renewal_date <= today`, so a missed day is picked up by the next run,
 * and a successful charge pushes next_renewal_date forward so a same-day
 * duplicate run finds nothing to charge.
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
    summary = await runPassRenewalJob();
  } catch (err) {
    return internalError("pass-renewal", err);
  }

  console.log(
    `[pass-renewal] ${trigger} run: ok=${summary.ok} reminders=${summary.remindersSent} renewed=${summary.renewed} lapsed=${summary.lapsed} errors=${summary.errors.length} queryErrors=${summary.queryErrors.length}`,
  );

  // A stage whose work-list query failed skipped an unknown number of
  // Passes, so the zero counters aren't a clean run — answer 500 so a
  // scheduler's failure alerting actually fires instead of seeing 200.
  return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
}
