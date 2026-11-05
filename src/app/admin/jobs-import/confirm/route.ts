import { handleConfirm } from "@/lib/jobs/sheet-import/handlers";
import { realDeps } from "@/lib/jobs/sheet-import/deps";

export const dynamic = "force-dynamic";
// Up to about 20 sequential batches (a canary of 10, then 50 at a time) and the audit rows. A literal 300, like the other long admin routes.
export const maxDuration = 300;

/** POST /admin/jobs-import/confirm: the only write; its own guard is in the handler (docs/admin-jobs-import.md). */
export async function POST(request: Request): Promise<Response> {
  return handleConfirm(request, realDeps());
}
