import "server-only";
import { auditDeleted } from "./audit";
import { DATA_EXPORT_BUCKET, objectPathFor, parseObjectName, type DeleteReason } from "./constants";
import { cancelStaleRows, getRow, markFailedRowCleaned, markObjectDeleted, removeObject, removeObjectCounted, type Client, type ExportRow } from "./store";

/**
 * THE HOURLY SWEEP of the data-exports bucket and of the rows that describe it (GET /api/admin/sweep-data-exports, called by .github/workflows/sweep-data-exports-hourly.yml).
 *
 * Access to a file ends at exactly 72 hours whatever this does (the claim function checks `expires_at`); the sweep only governs when the BYTES are deleted, and it is the only thing that
 * removes an orphan. Two passes every run, both idempotent and bounded (the remainder is picked up next hour):
 *
 *   PASS 1, ROWS.   (a) every `generating` row older than 15 minutes becomes `failed` and its attempt's object is removed; (b) every `generated` row past its end date, every `downloaded` row
 *                   whose download never finished deleting (T-A6: claimed more than ten minutes ago, still no deleted_at) and every `failed` row not yet cleaned has its object removed and is marked
 *                   `expired` / `deleted` / left `failed` with deleted_at set. A removal that FAILS leaves the row alone, counts an alert, and is retried next run.
 *   PASS 2, BUCKET. Lists the WHOLE bucket (a single list call is one page, so it pages until the listing is exhausted, folder by folder) and deletes every object that has no live row. LIVE means
 *                   a row exists for the object's export id, its current attempt id equals the object's attempt id, and it is `generating`, or `generated` and not expired, or `downloaded`
 *                   within the last ten minutes. A name that is not <uuid>/<uuid>.json is not a valid export and is deleted too. This is the pass that finds what the row pass cannot: an account
 *                   deleted inside the 72 hours takes its row with it (ON DELETE CASCADE) and leaves the object behind.
 *
 * WHY IT IS SAFE TO DELETE FROM THE BUCKET AT ALL. The start flow claims its row FIRST (status `generating`, an attempt id) and uploads SECOND, to a path made of those two ids. So every object has
 * a matching live row from the moment it exists, and the sweep cannot delete a file that is being written. An attempt that was cancelled while it ran can still upload late: its path carries ITS
 * attempt id, which no row owns any more, so the bucket pass removes it.
 *
 * COUNTS ONLY come out: no id, no path, no name. A deleted object writes `people.export_deleted` (system actor); orphans are counted and logged as a warning, because finding one means something upstream
 * is wrong.
 */

export interface SweepSummary {
  ok: boolean;
  staleCancelled: number;
  expired: number;
  downloadedCleaned: number;
  failedCleaned: number;
  listed: number;
  orphansDeleted: number;
  alerts: number;
  capped: boolean;
}

export interface SweepOptions {
  now?: () => Date;
  /** Rows handled per run in pass 1(b). */
  rowCap?: number;
  /** Objects deleted per run in pass 2. */
  deleteCap?: number;
  /** Objects listed per run in pass 2. */
  listCap?: number;
  /** Entries per storage list call. */
  pageSize?: number;
}

const CLAIMED_GRACE_MS = 10 * 60 * 1000;
const rowIdsPerQuery = 100;

export async function sweepDataExports(service: Client, options: SweepOptions = {}): Promise<SweepSummary> {
  const now = (options.now ?? (() => new Date()))();
  const rowCap = options.rowCap ?? 200;
  const deleteCap = options.deleteCap ?? 500;
  const listCap = options.listCap ?? 5000;
  const pageSize = options.pageSize ?? 100;
  const summary: SweepSummary = { ok: true, staleCancelled: 0, expired: 0, downloadedCleaned: 0, failedCleaned: 0, listed: 0, orphansDeleted: 0, alerts: 0, capped: false };

  // ── PASS 1(a): stale `generating` rows ──
  const stale = await cancelStaleRows(service);
  for (const r of stale) {
    summary.staleCancelled++;
    if (!(await removeObject(service, objectPathFor(r.exportId, r.attemptId)))) {
      summary.alerts++;
      continue;
    }
    await auditDeleted({ exportId: r.exportId, reason: "cancelled", userId: r.userId });
  }

  // ── PASS 1(b): rows whose bytes should be gone ──
  const claimedBefore = new Date(now.getTime() - CLAIMED_GRACE_MS).toISOString();
  const { data: due, error: dueError } = await service
    .from("data_export_files")
    .select("*")
    .is("deleted_at", null)
    .or(`and(status.eq.generated,expires_at.lte.${now.toISOString()}),and(status.eq.downloaded,claimed_at.lte.${claimedBefore}),status.eq.failed`)
    .order("created_at", { ascending: true })
    .limit(rowCap);
  if (dueError) {
    console.error("[data-export-sweep] could not read the rows to clean", dueError.code ?? "");
    summary.alerts++;
  }
  for (const row of due ?? []) {
    const path = row.object_path ?? objectPathFor(row.id, row.attempt_id);
    if (!(await removeObject(service, path))) {
      summary.alerts++;
      continue;
    }
    const status = row.status === "generated" ? "expired" : row.status === "downloaded" ? "deleted" : null;
    const reason: DeleteReason = row.status === "generated" ? "expired" : row.status === "downloaded" ? "downloaded" : "failed";
    // The run whose conditional update changes the row owns the count and the audit row. A run that finds the row already marked (another sweep got there first) has nothing left to do: no
    // count, no audit row, and no alert. A row that did NOT take the mark and is not marked either changed under us: the next run looks again.
    const won = await (status === null ? markFailedRowCleaned(service, { exportId: row.id, attemptId: row.attempt_id }) : markObjectDeleted(service, { exportId: row.id, attemptId: row.attempt_id, status })).catch(() => false);
    if (!won) {
      if (await alreadyCleaned(service, row.id)) continue;
      summary.alerts++;
      continue;
    }
    if (row.status === "generated") summary.expired++;
    else if (row.status === "downloaded") summary.downloadedCleaned++;
    else summary.failedCleaned++;
    await auditDeleted({ exportId: row.id, reason, userId: row.user_id });
  }

  // ── PASS 2: the whole bucket ──
  const objects = await listBucket(service, { pageSize, cap: listCap });
  summary.listed = objects.paths.length;
  summary.capped = objects.capped;
  if (objects.failed) summary.alerts++;

  const ids = [...new Set(objects.paths.map((p) => parseObjectName(p)?.exportId).filter((x): x is string => !!x))];
  const rows = new Map<string, ExportRow>();
  for (let i = 0; i < ids.length; i += rowIdsPerQuery) {
    const { data, error } = await service.from("data_export_files").select("*").in("id", ids.slice(i, i + rowIdsPerQuery));
    if (error) {
      // Without the rows nothing can be called an orphan: delete nothing from this pass.
      console.error("[data-export-sweep] could not read the rows for the bucket pass", error.code ?? "");
      summary.alerts++;
      summary.ok = false;
      return finish(summary);
    }
    for (const r of data ?? []) rows.set(r.id, r);
  }

  let orphanWarned = 0;
  for (const path of objects.paths) {
    if (summary.orphansDeleted >= deleteCap) {
      summary.capped = true;
      break;
    }
    const named = parseObjectName(path);
    const row = named ? rows.get(named.exportId) : undefined;
    if (named && row && isLive(row, named.attemptId, now)) continue;

    const gone = await removeObjectCounted(service, path);
    if (!gone.ok) {
      summary.alerts++;
      continue;
    }
    // Another run removed it between our listing and our delete: nothing of ours to count or audit.
    if (gone.removed === 0) continue;
    summary.orphansDeleted++;
    orphanWarned++;
    const reason: DeleteReason = named && row ? "cancelled" : "orphan";
    await auditDeleted({ exportId: named?.exportId ?? "", reason, userId: null });
  }
  if (orphanWarned > 0) console.warn(`[data-export-sweep] deleted ${orphanWarned} object(s) that had no live row`);

  return finish(summary);
}

/** True when the row is gone (its account was deleted) or already carries the cleanup mark, i.e. another run did this row's work. A read that fails counts as not done, so the run reports it. */
async function alreadyCleaned(service: Client, exportId: string): Promise<boolean> {
  try {
    const row = await getRow(service, exportId);
    return row === null || row.deleted_at !== null;
  } catch {
    return false;
  }
}

function finish(summary: SweepSummary): SweepSummary {
  summary.ok = summary.alerts === 0;
  return summary;
}

/** A live object: its row exists for the same attempt and is generating, generated and not expired, or recently claimed (a download may still be reading it). */
export function isLive(row: ExportRow, attemptId: string, now: Date): boolean {
  if (row.attempt_id !== attemptId) return false;
  if (row.status === "generating") return true;
  if (row.status === "generated") return row.expires_at !== null && new Date(row.expires_at).getTime() > now.getTime();
  if (row.status === "downloaded") return row.claimed_at !== null && now.getTime() - new Date(row.claimed_at).getTime() < CLAIMED_GRACE_MS;
  return false;
}

/**
 * Every object in the bucket as a path, paging until the listing is exhausted: the root first (flat files and folders), then each folder. `failed` is true when a list call errored, in which
 * case the paths are only what was seen (nothing is deleted for lack of a name, only for lack of a live row on a name that WAS seen).
 */
async function listBucket(service: Client, opts: { pageSize: number; cap: number }): Promise<{ paths: string[]; capped: boolean; failed: boolean }> {
  const bucket = service.storage.from(DATA_EXPORT_BUCKET);
  const paths: string[] = [];
  let failed = false;
  let capped = false;

  const page = async (prefix: string, offset: number) => bucket.list(prefix, { limit: opts.pageSize, offset, sortBy: { column: "name", order: "asc" } });

  const folders: string[] = [];
  for (let offset = 0; ; offset += opts.pageSize) {
    const { data, error } = await page("", offset);
    if (error) {
      failed = true;
      break;
    }
    const entries = data ?? [];
    for (const e of entries) {
      if (e.id === null) folders.push(e.name);
      else paths.push(e.name);
    }
    if (entries.length < opts.pageSize) break;
  }

  for (const folder of folders) {
    for (let offset = 0; ; offset += opts.pageSize) {
      if (paths.length >= opts.cap) {
        capped = true;
        break;
      }
      const { data, error } = await page(folder, offset);
      if (error) {
        failed = true;
        break;
      }
      const entries = data ?? [];
      for (const e of entries) paths.push(`${folder}/${e.name}`);
      if (entries.length < opts.pageSize) break;
    }
    if (capped) break;
  }
  return { paths, capped, failed };
}
