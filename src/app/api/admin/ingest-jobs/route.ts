import { NextResponse } from "next/server";
import { ingestAllSources } from "@/lib/jobs/ingest";

/**
 * Trigger for the job aggregation pipeline. Not on any user-facing request
 * path — point a Vercel Cron job (or any scheduler) at this once deployed,
 * authenticated with INGEST_SECRET. Runs on demand until then.
 */
export async function POST(request: Request) {
  const secret = process.env.INGEST_SECRET;
  if (secret) {
    const provided = request.headers.get("x-ingest-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const results = await ingestAllSources();
  return NextResponse.json({ results });
}
