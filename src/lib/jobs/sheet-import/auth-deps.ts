import "server-only";
import { getAdmin } from "@/lib/admin/require-admin";
import { realAudit } from "./audit";
import type { HandlerDeps } from "./handlers";

/**
 * The dependencies the handlers need BEFORE they know who is asking: the identity (the ADMIN SESSION: getAdmin reads the admin cookie, never the seeker session), the audit writes, the
 * clock and the log (a class and nothing else). The database client is not here: it comes from deps.ts, lazily, after the permission check.
 */
export function realAuthDeps(): Omit<HandlerDeps, "service"> {
  return {
    getAdmin,
    audit: realAudit(),
    now: () => new Date(),
    log: (errorClass) => console.error("[jobs-import]", errorClass),
  };
}
