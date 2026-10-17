import { NextResponse } from "next/server";
import { internalError, requireCronSecret } from "@/lib/api/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { sweepDataExports } from "@/lib/data-export/sweep";

export const dynamic = "force-dynamic";
// Valid on every plan (300 s is the Hobby maximum; the project is on Pro now, but a literal 300 is what the repo pins, see the ingest route). The sweep is bounded per run and does a
// handful of storage calls, so it finishes in seconds; the literal is a ceiling, not a budget. Recorded in docs/admin-data-export.md.
export const maxDuration = 300;

/**
 * The hourly sweep of the private data-exports bucket (src/lib/data-export/sweep.ts), called by .github/workflows/sweep-data-exports-hourly.yml with `Authorization: Bearer <CRON_SECRET>`.
 * It is NOT in vercel.json: nothing here depends on the plan's cron limits.
 *
 * GET only, behind requireCronSecret (fail closed: no CRON_SECRET configured means 401 for everyone). The answer is COUNTS ONLY, never an id, a name or a path: the workflow log of this
 * public repository echoes it. `ok: false` with a non-zero `alerts` means a delete failed (or a listing did) and will be retried next hour; the workflow turns that into a failed run.
 */
export async function GET(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;
  try {
    const summary = await sweepDataExports(createServiceRoleClient());
    return NextResponse.json({ summary }, { status: 200 });
  } catch (err) {
    return internalError("sweep-data-exports", err);
  }
}
