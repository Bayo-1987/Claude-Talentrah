import type { AdminPermission } from "@/lib/admin/session";
import { MessagingError } from "./errors";

/**
 * The acting admin, as the service sees them: the id and the permissions the VERIFIED ADMIN SESSION carries (`requirePermission` in the page or the Server Action returns this shape). It is never built from a form, a
 * query string or a request body: every database function takes the actor as an argument, and this is the only place that argument comes from.
 */
export interface AdminActor {
  adminId: string;
  permissions: readonly AdminPermission[];
}

/** Refuses, before any database call, an actor who does not hold the permission. The database checks the same permission again; this is the first of the two. */
export function requireHolder(actor: AdminActor, permission: AdminPermission): void {
  if (!actor || typeof actor.adminId !== "string" || actor.adminId === "" || !actor.permissions.includes(permission)) {
    throw new MessagingError("permission_denied", "this operator does not hold the permission this needs");
  }
}
