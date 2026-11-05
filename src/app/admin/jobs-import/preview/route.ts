import { handlePreview } from "@/lib/jobs/sheet-import/handlers";
import { realDeps } from "@/lib/jobs/sheet-import/deps";

export const dynamic = "force-dynamic";
// Parsing and planning at most 1,000 rows and reading their fingerprints in chunks of 200: seconds, not minutes.
export const maxDuration = 60;

/** POST /admin/jobs-import/preview: reads only; its own guard is in the handler (docs/admin-jobs-import.md). */
export async function POST(request: Request): Promise<Response> {
  return handlePreview(request, realDeps());
}
