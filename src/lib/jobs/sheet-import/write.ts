import type { JobInsert } from "./plan";
import { MAX_BATCH } from "./plan";
import { EXISTING_FINGERPRINT_CHUNK } from "./limits";

/**
 * The two database calls the uploader makes, so a test hands in a fake and the route hands in the service-role client. INSERT-ONLY: there is no update, no delete.
 * Nothing here reads an error's text: an error from the database can quote the failing row (an address), so only its CLASS leaves this file.
 */
type Reply<T> = PromiseLike<{ data: T | null; error: { code?: string } | null }>;
export interface ImportWriteClient {
  from(table: "job_postings"): {
    upsert(rows: JobInsert[], options: { onConflict: string; ignoreDuplicates: boolean }): { select(columns: string): Reply<Array<{ id: string }>> };
    select(columns: string): { in(column: string, values: string[]): Reply<Array<{ dedup_fingerprint: string }>> };
  };
}

const SAFE_NAME = /^[A-Za-z0-9_]{1,30}$/;
const PG_CODE = /^[0-9A-Z]{5}$/;

/** A short class for an error: its name and, when it carries one, its five-character database code. Never its message. */
export function classOfError(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { name?: unknown; code?: unknown };
    const name = typeof o.name === "string" && SAFE_NAME.test(o.name) ? o.name : "Error";
    return typeof o.code === "string" && PG_CODE.test(o.code) ? `${name}:${o.code}` : name;
  }
  return "Error";
}

export type BatchOutcome = { ok: true; attempted: number; inserted: number; skippedExisting: number } | { ok: false; errorClass: string };

/** ONE batch: INSERT ... ON CONFLICT (dedup_fingerprint) DO NOTHING. A batch above 50 is refused before anything is sent. */
export async function writeBatch(client: ImportWriteClient, rows: JobInsert[]): Promise<BatchOutcome> {
  if (rows.length > MAX_BATCH) return { ok: false, errorClass: "BatchTooLarge" };
  if (rows.length === 0) return { ok: true, attempted: 0, inserted: 0, skippedExisting: 0 };
  try {
    const { data, error } = await client.from("job_postings").upsert(rows, { onConflict: "dedup_fingerprint", ignoreDuplicates: true }).select("id");
    if (error) return { ok: false, errorClass: classOfError(error) };
    const inserted = data?.length ?? 0;
    return { ok: true, attempted: rows.length, inserted, skippedExisting: rows.length - inserted };
  } catch (e) {
    return { ok: false, errorClass: classOfError(e) };
  }
}

/** Which of these fingerprints are already in job_postings (any source): a read-only select, in chunks of at most 200. */
export async function readExistingFingerprints(client: ImportWriteClient, fingerprints: string[]): Promise<{ ok: true; existing: Set<string> } | { ok: false; errorClass: string }> {
  const existing = new Set<string>();
  try {
    for (let i = 0; i < fingerprints.length; i += EXISTING_FINGERPRINT_CHUNK) {
      const chunk = fingerprints.slice(i, i + EXISTING_FINGERPRINT_CHUNK);
      const { data, error } = await client.from("job_postings").select("dedup_fingerprint").in("dedup_fingerprint", chunk);
      if (error) return { ok: false, errorClass: classOfError(error) };
      for (const r of data ?? []) existing.add(r.dedup_fingerprint);
    }
    return { ok: true, existing };
  } catch (e) {
    return { ok: false, errorClass: classOfError(e) };
  }
}
