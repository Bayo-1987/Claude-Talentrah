import { NextResponse } from "next/server";
import { ingestScholarships } from "@/lib/scholarships/ingest";

/**
 * Trigger for the scholarship aggregation pipeline. Not on any user-facing
 * request path — same authenticated-admin-route shape as
 * /api/admin/ingest-jobs, meant to be pointed at a scheduler later.
 *
 * Deliberately NOT wired into vercel.json's crons in this milestone: the
 * Pass renewal job was sequenced the same way (built and proven first,
 * scheduled as its own separate step), and this project is on Vercel's
 * Hobby plan where crons are capped at one run per day per expression — so
 * adding a second daily entry is a scheduling decision worth making
 * explicitly rather than as a side effect of a feature build.
 */
export async function POST(request: Request) {
  const secret = process.env.INGEST_SECRET;
  if (secret) {
    const provided = request.headers.get("x-ingest-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const summary = await ingestScholarships();
  // Non-2xx on a failed run so a scheduler's alerting fires instead of
  // reading an all-zero summary as a clean pass — same lesson as the Pass
  // renewal job's query-error handling.
  return NextResponse.json({ summary }, { status: summary.ok ? 200 : 500 });
}
