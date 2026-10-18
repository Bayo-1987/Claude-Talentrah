/**
 * Loosely typed access to the data_export_files table and its functions for tests (the generated types are regenerated after the hosted apply, so the calls go through a handle that does
 * not need them), plus the small fixtures the DB-level suites share. Local stack only: everything here goes through tests/support/auth.ts's service client, which tests/setup.ts guards.
 */
import { randomUUID } from "node:crypto";
import { admin } from "./auth";

export type Answer = { data: unknown; error: { code?: string; message: string } | null };
export type LooseQuery = { [method: string]: (...args: unknown[]) => LooseQuery } & PromiseLike<Answer>;
export type Loose = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<Answer>; from: (t: string) => LooseQuery };
export const svc = admin as unknown as Loose;

export interface ExportRow {
  id: string; user_id: string; attempt_id: string; status: string; object_path: string | null;
  expires_at: string | null; claimed_at: string | null; deleted_at: string | null; attempt_started_at: string; created_by_admin: string | null;
}

export const pathFor = (id: string, attempt: string) => `${id}/${attempt}.json`;

/** Inserts a `generating` row the way the start flow does (new export id, new attempt id). */
export async function insertGenerating(userId: string, over: Record<string, unknown> = {}): Promise<{ id: string; attempt: string }> {
  const id = randomUUID();
  const attempt = randomUUID();
  const { error } = await (svc.from("data_export_files").insert({ id, user_id: userId, attempt_id: attempt, status: "generating", ...over }) as unknown as PromiseLike<Answer>);
  if (error) throw new Error(`insertGenerating: ${error.message}`);
  return { id, attempt };
}

export async function getRow(id: string): Promise<ExportRow | null> {
  const { data, error } = await (svc.from("data_export_files").select("*").eq("id", id).maybeSingle() as unknown as PromiseLike<Answer>);
  if (error) throw new Error(`getRow: ${error.message}`);
  return (data as ExportRow | null) ?? null;
}

export async function setRow(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await (svc.from("data_export_files").update(patch).eq("id", id) as unknown as PromiseLike<Answer>);
  if (error) throw new Error(`setRow: ${error.message}`);
}

/** Moves a row's attempt start back in time (the 15-minute rule is measured against the database clock, so a test ages the row instead of waiting). */
export const ageAttempt = (id: string, minutes: number) => setRow(id, { attempt_started_at: new Date(Date.now() - minutes * 60_000).toISOString() });

/** Makes a `generating` row `generated` through the real finish function. */
export async function finish(id: string, attempt: string): Promise<string | null> {
  const { data, error } = await svc.rpc("finish_data_export_attempt", { p_export_id: id, p_attempt_id: attempt, p_object_path: pathFor(id, attempt) });
  if (error) throw new Error(`finish: ${error.message}`);
  return (data as string | null) ?? null;
}

export async function deleteRowsFor(userIds: string[]): Promise<void> {
  for (const uid of userIds) {
    const { error } = await (svc.from("data_export_files").delete().eq("user_id", uid) as unknown as PromiseLike<Answer>);
    if (error) throw new Error(`cleanup data_export_files: ${error.message}`);
  }
}
