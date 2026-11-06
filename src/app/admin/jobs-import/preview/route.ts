import { handlePreview } from "@/lib/jobs/sheet-import/handlers";
import { realAuthDeps } from "@/lib/jobs/sheet-import/auth-deps";

export const dynamic = "force-dynamic";
// Parsing and planning at most 1,000 rows and reading their fingerprints in chunks of 200: seconds, not minutes.
export const maxDuration = 60;

/** POST /admin/jobs-import/preview: reads only; its own guard is in the handler (docs/admin-jobs-import.md). */
export async function POST(request: Request): Promise<Response> {
  return handlePreview(request, {
    ...realAuthDeps(),
    // The service-role client is loaded here, lazily, and only when the handler asks for it: after the permission check (docs/admin-jobs-import.md).
    service: async () => (await import("@/lib/jobs/sheet-import/deps")).realService(),
  });
}
