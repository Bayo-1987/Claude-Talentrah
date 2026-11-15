import { getAdmin } from "@/lib/admin/require-admin";
import { handleDryRun, type LifecycleReadClient } from "@/lib/jobs/lifecycle";

export const dynamic = "force-dynamic";
// Reads the closed postings in pages of 1,000 (at most 10) and the 15 blocking tables in chunks of 200 ids: seconds.
export const maxDuration = 60;

/**
 * POST /admin/job-lifecycle/dry-run (JOBS-LIFECYCLE-1 W0): what would a lifecycle run close and delete, and what stops it. READ-ONLY: it writes nothing, not even a run row. The guard (admin
 * session, `jobs_import`) is in the handler, because the protected layout does not cover route handlers.
 */
export async function POST(request: Request): Promise<Response> {
  return handleDryRun(request, {
    getAdmin,
    // The service-role client is loaded here, lazily, and only when the handler asks for it: after the permission check.
    service: async () => (await import("@/lib/supabase/service-role")).createServiceRoleClient() as unknown as LifecycleReadClient,
    now: () => new Date(),
    log: (errorClass) => console.error("[job-lifecycle-dry-run]", errorClass),
  });
}
