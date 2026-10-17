import "server-only";
import { recordAdminAction, recordAdminActionStrict, SYSTEM_DATA_EXPORT_ACTOR } from "@/lib/admin/audit";
import { EXPORT_AUDIT_ACTIONS, UUID_PATTERN, type DeleteReason, type FinishOutcome, type ReasonCode, type RefusalCode, type RequesterCheck } from "./constants";

/**
 * Every audit row the data export writes, in one place, so what a row may contain is decided once.
 *
 * NO PERSONAL CONTENT, ever: a row carries the target's uuid (only when it IS a uuid), the admin's identity (the columns every audit row already has), counts, and short codes from the fixed
 * lists in constants.ts. The ticket reference is validated by pattern before it gets here; the reason and the requester check are pick-list codes; an error is a CLASS (a name), never a message.
 * A target that is not a valid uuid is NEVER written into a row: an admin could have pasted an email address into that field, so such a row has a null target and no copy of the input.
 *
 * Two kinds of writer. The STRICT one (requested, generated, cancelled, finished) throws when the row cannot be written, and the caller then reads nothing and refuses. The ordinary one
 * (denied, notice sent, downloaded, deleted) never throws: those rows describe something that already happened, and refusing to continue because the log was down would be worse than a gap.
 */

export type Admin = { adminId: string; email: string; sessionId?: string | null };
type Detail = { [key: string]: string | number | boolean | null };

const safeTarget = (id: string | null | undefined): string | null => (id && UUID_PATTERN.test(id) ? id.toLowerCase() : null);
const systemActor = { adminId: null, email: SYSTEM_DATA_EXPORT_ACTOR, sessionId: null } as const;

/** Row 1 of every start or cancel, written BEFORE anything is read. Throws if it cannot be written. Returns the row id that the later rows point back to. */
export async function auditRequested(admin: Admin, input: { operation: "start" | "cancel"; targetId: string | null; ticket: string; reason: ReasonCode | null; requesterCheck: RequesterCheck | null }): Promise<string> {
  return recordAdminActionStrict({
    identity: admin,
    action: EXPORT_AUDIT_ACTIONS.requested,
    targetTable: "profiles",
    targetId: safeTarget(input.targetId),
    detail: { operation: input.operation, ticket: input.ticket, reason: input.reason, requester_check: input.requesterCheck } satisfies Detail,
  });
}

/** The last row of every start or cancel. `refusalCode` is set exactly when the outcome is "refused". Throws if it cannot be written. */
export async function auditFinished(
  admin: Admin,
  input: { requestedId: string; targetId: string | null; exportId?: string | null; outcome: FinishOutcome; refusalCode?: RefusalCode | null; errorClass?: string | null },
): Promise<string> {
  return recordAdminActionStrict({
    identity: admin,
    action: EXPORT_AUDIT_ACTIONS.finished,
    targetTable: "profiles",
    targetId: safeTarget(input.targetId),
    detail: {
      requested_id: input.requestedId,
      export_id: input.exportId ?? null,
      outcome: input.outcome,
      refusal_code: input.outcome === "refused" ? (input.refusalCode ?? null) : null,
      error_class: input.errorClass ?? null,
    } satisfies Detail,
  });
}

export async function auditNoticeSent(admin: Admin, input: { requestedId: string; targetId: string; exportId: string }): Promise<void> {
  await recordAdminAction({
    identity: admin,
    action: EXPORT_AUDIT_ACTIONS.noticeSent,
    targetTable: "profiles",
    targetId: safeTarget(input.targetId),
    detail: { requested_id: input.requestedId, export_id: input.exportId } satisfies Detail,
  });
}

/** The file exists. Strict: if it cannot be recorded, the export is taken back. Counts only. */
export async function auditGenerated(admin: Admin, input: { requestedId: string; targetId: string; exportId: string; tables: number; rows: number; bytes: number }): Promise<string> {
  return recordAdminActionStrict({
    identity: admin,
    action: EXPORT_AUDIT_ACTIONS.generated,
    targetTable: "profiles",
    targetId: safeTarget(input.targetId),
    detail: { requested_id: input.requestedId, export_id: input.exportId, tables: input.tables, rows: input.rows, bytes: input.bytes } satisfies Detail,
  });
}

/** Support's cancel of an unused export. Strict. */
export async function auditCancelled(admin: Admin, input: { requestedId: string; targetId: string; exportId: string }): Promise<string> {
  return recordAdminActionStrict({
    identity: admin,
    action: EXPORT_AUDIT_ACTIONS.cancelled,
    targetTable: "profiles",
    targetId: safeTarget(input.targetId),
    detail: { requested_id: input.requestedId, export_id: input.exportId } satisfies Detail,
  });
}

/** A caller WITHOUT the permission. Not a refusal after authorisation, so it is its own action. */
export async function auditDenied(admin: Admin, input: { operation: "start" | "cancel" | "download"; reason: "missing_permission" | "wrong_account" }): Promise<void> {
  await recordAdminAction({
    identity: admin,
    action: EXPORT_AUDIT_ACTIONS.denied,
    detail: { operation: input.operation, reason: input.reason } satisfies Detail,
  });
}

/** A signed-in account that is not the owner opened somebody's link. Written by the system actor: there is no admin. */
export async function auditDownloadDenied(input: { exportId: string }): Promise<void> {
  await recordAdminAction({
    identity: systemActor,
    action: EXPORT_AUDIT_ACTIONS.denied,
    targetTable: "data_export_files",
    targetId: safeTarget(input.exportId),
    detail: { operation: "download", reason: "wrong_account" } satisfies Detail,
  });
}

/** The owner opened their link and the file was handed over (the claim won). System actor. */
export async function auditDownloaded(input: { exportId: string; userId: string; bytes: number | null }): Promise<void> {
  await recordAdminAction({
    identity: systemActor,
    action: EXPORT_AUDIT_ACTIONS.downloaded,
    targetTable: "profiles",
    targetId: safeTarget(input.userId),
    detail: { export_id: input.exportId, bytes: input.bytes } satisfies Detail,
  });
}

/** An object was deleted from the bucket, and why. `actor` is the system unless an admin's own action did it (a cancelled stale attempt). */
export async function auditDeleted(input: { exportId: string; reason: DeleteReason; actor?: Admin; userId?: string | null; count?: number }): Promise<void> {
  await recordAdminAction({
    identity: input.actor ?? systemActor,
    action: EXPORT_AUDIT_ACTIONS.deleted,
    targetTable: input.userId ? "profiles" : "data_export_files",
    targetId: safeTarget(input.userId ?? input.exportId),
    detail: { export_id: safeTarget(input.exportId), reason: input.reason, count: input.count ?? 1 } satisfies Detail,
  });
}
