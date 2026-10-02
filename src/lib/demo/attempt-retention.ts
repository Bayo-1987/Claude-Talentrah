import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Retention for the homepage-demo attempt log (migration 0208).
 *
 * The table holds no personal data (short codes and a timestamp, enforced by the schema), but an attempt log should not
 * grow forever. Rows older than 90 days are deleted: the 7-day view reads only the last week, so 90 days is about
 * thirteen weeks of trend before the data stops being useful.
 *
 * NO SQL FUNCTION, so no migration: select the ids of the oldest expired rows (a batch at a time, with the service-role
 * client) and delete them BY ID. Two properties are deliberate:
 *
 *   BOUNDED. A fixed number of rounds per run (PURGE_MAX_ROUNDS x PURGE_BATCH_SIZE rows, 10,000). A run that hits the
 *   cap says so (`hitCap`) and the next daily run continues; nothing here can run unbounded or hold a long lock.
 *
 *   THE PREDICATE IS RE-ASSERTED INSIDE EVERY DELETE. Deleting by id alone would trust the SELECT that produced the ids;
 *   `.lt("created_at", cutoff)` on the delete itself means a row that is not actually expired cannot be removed even if
 *   an id were wrong. The same shape as deleteStaleClosedPostings.
 *
 * It reports what it did (deleted, rounds, hitCap) and returns an error rather than throwing on a failed query, so the
 * route can log it and answer 500: a purge whose logs go quiet on a bad day looks exactly like one with nothing to delete.
 */

export const ATTEMPT_RETENTION_DAYS = 90;
/** Rows selected, and deleted, per round. */
export const PURGE_BATCH_SIZE = 1000;
/** Rounds per run: 10 x 1,000 = at most 10,000 rows a run. */
export const PURGE_MAX_ROUNDS = 10;

const DAY_MS = 86_400_000;

export interface PurgeResult {
  /** Rows strictly older than this were eligible. */
  cutoff: string;
  deleted: number;
  /** Rounds that selected at least one row. */
  rounds: number;
  /** True when the run stopped because it used all its rounds with a full last batch: more may remain. */
  hitCap: boolean;
  /** Set when a query failed; `deleted` is what had already been removed. */
  error?: string;
}

export interface PurgeOptions {
  now?: Date;
  retentionDays?: number;
  batchSize?: number;
  maxRounds?: number;
  /** For tests. */
  client?: ReturnType<typeof createServiceRoleClient>;
}

export async function purgeOldDemoAttempts(opts: PurgeOptions = {}): Promise<PurgeResult> {
  const now = opts.now ?? new Date();
  const retentionDays = opts.retentionDays ?? ATTEMPT_RETENTION_DAYS;
  const batchSize = opts.batchSize ?? PURGE_BATCH_SIZE;
  const maxRounds = opts.maxRounds ?? PURGE_MAX_ROUNDS;
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  const supabase = opts.client ?? createServiceRoleClient();

  let deleted = 0;
  let rounds = 0;
  let hitCap = false;

  for (let round = 1; round <= maxRounds; round++) {
    const { data: batch, error: selectError } = await supabase
      .from("anonymous_demo_attempts")
      .select("id")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(batchSize);
    if (selectError) return { cutoff, deleted, rounds, hitCap: false, error: selectError.message };
    if (!batch || batch.length === 0) break;
    rounds += 1;

    const { data: gone, error: deleteError } = await supabase
      .from("anonymous_demo_attempts")
      .delete()
      .in(
        "id",
        batch.map((row) => row.id),
      )
      .lt("created_at", cutoff)
      .select("id");
    if (deleteError) return { cutoff, deleted, rounds, hitCap: false, error: deleteError.message };
    deleted += gone?.length ?? 0;

    if (batch.length < batchSize) break; // a short batch: nothing more is due
    if (round === maxRounds) hitCap = true; // a full batch on the last round: more may remain
  }

  return { cutoff, deleted, rounds, hitCap };
}
