import "server-only";
import { getAdmin } from "@/lib/admin/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { realAudit } from "./audit";
import type { HandlerDeps } from "./handlers";
import type { ImportWriteClient } from "./write";

/**
 * The real dependencies of the two route handlers. The identity is the ADMIN SESSION (getAdmin reads the admin cookie, never the seeker session). The only database client is the
 * service-role one, created inside `service()` which the handlers call only after the permission check: no browser or session client ever touches job_postings, and no grant, policy or
 * function is added for it. The log line is a class and nothing else.
 */
export function realDeps(): HandlerDeps {
  return {
    getAdmin,
    audit: realAudit(),
    service: () => createServiceRoleClient() as unknown as ImportWriteClient,
    now: () => new Date(),
    log: (errorClass) => console.error("[jobs-import]", errorClass),
  };
}
