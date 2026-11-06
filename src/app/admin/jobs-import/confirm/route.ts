import { handleConfirm } from "@/lib/jobs/sheet-import/handlers";
import { realAuthDeps } from "@/lib/jobs/sheet-import/auth-deps";

export const dynamic = "force-dynamic";
// Up to about 20 sequential batches (a canary of 10, then 50 at a time) and the audit rows. A literal 300, like the other long admin routes.
export const maxDuration = 300;

/** POST /admin/jobs-import/confirm: the only write; its own guard is in the handler (docs/admin-jobs-import.md). */
export async function POST(request: Request): Promise<Response> {
  return handleConfirm(request, {
    ...realAuthDeps(),
    // The service-role client is loaded here, lazily, and only when the handler asks for it: after the permission check (docs/admin-jobs-import.md).
    service: async () => (await import("@/lib/jobs/sheet-import/deps")).realService(),
  });
}
