import { NextResponse } from "next/server";
import { runPassRenewalJob } from "@/lib/billing/renewals";

/**
 * Trigger for the Pass auto-renewal job (fix-prompt §1). Not on any
 * user-facing request path — point a Vercel Cron job (or any scheduler,
 * e.g. daily) at this once deployed, authenticated with
 * PASS_RENEWAL_SECRET. Mirrors src/app/api/admin/ingest-jobs's pattern
 * exactly rather than inventing new cron infrastructure. Runs on demand
 * until a real scheduler is wired up.
 */
export async function POST(request: Request) {
  const secret = process.env.PASS_RENEWAL_SECRET;
  if (secret) {
    const provided = request.headers.get("x-renewal-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const summary = await runPassRenewalJob();
  // A stage whose work-list query failed skipped an unknown number of
  // Passes, so the zero counters aren't a clean run — answer 500 so a
  // scheduler's failure alerting actually fires instead of seeing 200.
  return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
}
