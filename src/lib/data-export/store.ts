import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/types";
import { DATA_EXPORT_BUCKET } from "./constants";

/**
 * The only code that reads or writes `data_export_files` (0263) and the `data-exports` bucket. Service role only: the table has no policy and no client grant, the bucket has no storage policy.
 *
 * Every state change here is ONE statement (a SQL function or a conditional UPDATE/INSERT), never a read followed by a write in TypeScript: two admins starting together, or a slow attempt
 * that was given up on finishing late, would otherwise both succeed. The functions are in supabase/migrations/0263_data_export_files.sql; read its header.
 *
 * Functions here THROW only on a database or storage error. A "no" from a conditional statement (zero rows) is a normal return value.
 */

export type Client = SupabaseClient<Database>;
export type ExportRow = Tables<"data_export_files">;

export class StoreError extends Error {
  constructor(
    readonly step: string,
    readonly code: string | null,
  ) {
    // The database's own message can carry table or constraint detail; the step and the SQLSTATE are enough to find it in the logs.
    super(`data export store: ${step} failed${code ? ` (${code})` : ""}`);
    this.name = "StoreError";
  }
}

const fail = (step: string, error: { code?: string; message?: string } | null): never => {
  console.error(`[data-export] ${step} failed`, error?.code ?? "", error?.message ?? "");
  throw new StoreError(step, error?.code ?? null);
};

/** The person's live row (generating or generated), if any. The partial unique index guarantees at most one. */
export async function getLiveRow(service: Client, userId: string): Promise<ExportRow | null> {
  const { data, error } = await service.from("data_export_files").select("*").eq("user_id", userId).in("status", ["generating", "generated"]).maybeSingle();
  if (error) fail("read the live row", error);
  return data ?? null;
}

export async function getRow(service: Client, exportId: string): Promise<ExportRow | null> {
  const { data, error } = await service.from("data_export_files").select("*").eq("id", exportId).maybeSingle();
  if (error) fail("read the row", error);
  return data ?? null;
}

/** One INSERT. `already_live` is the unique-index loser (SQLSTATE 23505): somebody else holds the person's one live slot. */
export async function insertAttempt(service: Client, input: { exportId: string; attemptId: string; userId: string; adminId: string | null }): Promise<"inserted" | "already_live"> {
  const { error } = await service.from("data_export_files").insert({ id: input.exportId, attempt_id: input.attemptId, user_id: input.userId, created_by_admin: input.adminId, status: "generating" });
  if (!error) return "inserted";
  if (error.code === "23505") return "already_live";
  return fail("insert the attempt", error);
}

/** Hands a `generating` row older than 15 minutes to a new attempt. True = this caller won; false = not stale, or somebody else swapped it first. */
export async function swapStaleAttempt(service: Client, input: { exportId: string; oldAttemptId: string; newAttemptId: string }): Promise<boolean> {
  const { data, error } = await service.rpc("swap_stale_data_export_attempt", { p_export_id: input.exportId, p_old_attempt: input.oldAttemptId, p_new_attempt: input.newAttemptId });
  if (error) fail("swap the stale attempt", error);
  return (data ?? []).length === 1;
}

/** The finish: generating -> generated for the attempt that still owns the row. Returns the end date, or null when the attempt was cancelled. */
export async function finishAttempt(service: Client, input: { exportId: string; attemptId: string; objectPath: string }): Promise<string | null> {
  const { data, error } = await service.rpc("finish_data_export_attempt", { p_export_id: input.exportId, p_attempt_id: input.attemptId, p_object_path: input.objectPath });
  if (error) fail("finish the attempt", error);
  return data ?? null;
}

/** generating -> failed, for the attempt that still owns the row (a conditional UPDATE). True when this call changed it. */
export async function failAttempt(service: Client, input: { exportId: string; attemptId: string }): Promise<boolean> {
  const { data, error } = await service.from("data_export_files").update({ status: "failed" }).eq("id", input.exportId).eq("attempt_id", input.attemptId).eq("status", "generating").select("id");
  if (error) fail("fail the attempt", error);
  return (data ?? []).length === 1;
}

/** Every `generating` row older than 15 minutes becomes `failed`; the rows it changed are returned so their objects can be removed. */
export async function cancelStaleRows(service: Client): Promise<Array<{ exportId: string; userId: string; attemptId: string }>> {
  const { data, error } = await service.rpc("cancel_stale_data_exports");
  if (error) fail("cancel the stale rows", error);
  return (data ?? []).map((r) => ({ exportId: r.export_id, userId: r.user_id, attemptId: r.attempt_id }));
}

/** Support's cancel: generated and never claimed -> cancelled. Returns the object path to delete, or null when it was not cancellable. */
export async function cancelUnused(service: Client, input: { exportId: string; userId: string }): Promise<string | null> {
  const { data, error } = await service.rpc("cancel_unused_data_export", { p_export_id: input.exportId, p_user_id: input.userId });
  if (error) fail("cancel the unused export", error);
  return data ?? null;
}

/** The single use. Returns the CURRENT attempt's object path, or null for not yours / used / expired / not ready (the caller cannot tell which, by design). */
export async function claimDownload(service: Client, input: { exportId: string; userId: string }): Promise<string | null> {
  const { data, error } = await service.rpc("claim_data_export_download", { p_export_id: input.exportId, p_user_id: input.userId });
  if (error) fail("claim the download", error);
  return data ?? null;
}

/** The bytes are gone: sets deleted_at and, where asked, `expired` / `deleted`. Conditional on the attempt id. True when a row matched. */
export async function markObjectDeleted(service: Client, input: { exportId: string; attemptId: string; status: "expired" | "deleted" | null }): Promise<boolean> {
  const { data, error } = await service.rpc("mark_data_export_object_deleted", { p_export_id: input.exportId, p_attempt_id: input.attemptId, ...(input.status ? { p_status: input.status } : {}) });
  if (error) fail("mark the object deleted", error);
  return data !== null;
}

/**
 * The cleanup mark of a `failed` row, as ONE conditional update: it sets deleted_at only if the row is still `failed`, still this attempt's and not yet marked. True for the one run that changed it,
 * false for any other (the row was already marked, is not failed, or belongs to another attempt). Two sweeps that overlap therefore cannot both mark, count and audit the same row.
 */
export async function markFailedRowCleaned(service: Client, input: { exportId: string; attemptId: string }): Promise<boolean> {
  const { data, error } = await service
    .from("data_export_files")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.exportId)
    .eq("attempt_id", input.attemptId)
    .eq("status", "failed")
    .is("deleted_at", null)
    .select("id");
  if (error) fail("mark the failed row cleaned", error);
  return (data ?? []).length === 1;
}

/* ─── the bucket ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */

export async function uploadObject(service: Client, path: string, body: Blob): Promise<void> {
  const { error } = await service.storage.from(DATA_EXPORT_BUCKET).upload(path, body, { contentType: "application/json", upsert: false });
  if (error) fail("upload the object", { message: error.message });
}

/**
 * Removes one object. A Supabase delete that is rejected does NOT throw, it resolves with an error, so the error is read here. Removing an object that is not there is not an error.
 * Returns true when the object is gone (removed now, or never there), false when the storage service refused: the caller keeps the row so the next sweep retries.
 */
export async function removeObject(service: Client, path: string): Promise<boolean> {
  return (await removeObjectCounted(service, path)).ok;
}

/**
 * The same removal, and HOW MANY objects the storage service reported removing: 1 when the object was there, 0 when it was not (tests/storage/data-exports-remove-missing.test.ts holds that
 * against the real service). The sweep counts and audits an orphan only when its own call reports 1, so two runs that overlap do not both claim one object.
 */
export async function removeObjectCounted(service: Client, path: string): Promise<{ ok: boolean; removed: number }> {
  const { data, error } = await service.storage.from(DATA_EXPORT_BUCKET).remove([path]);
  if (error) {
    console.error("[data-export] could not remove an object", error.message);
    return { ok: false, removed: 0 };
  }
  return { ok: true, removed: data?.length ?? 0 };
}

export async function downloadObject(service: Client, path: string): Promise<Blob | null> {
  const { data, error } = await service.storage.from(DATA_EXPORT_BUCKET).download(path);
  if (error || !data) return null;
  return data;
}
