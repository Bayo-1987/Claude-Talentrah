import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { BANNER_BUCKET } from "@/lib/employer/banner";

/**
 * Stage 5b: permanently delete a job posting once it has been CLOSED for 30+
 * days.
 *
 * ── WHY THIS IS A SEPARATE, LATER STEP FROM closeStaleExternalPostings ──────
 *
 * expiry.ts's two sweeps and ingest.ts's presence-driven sweep only ever
 * change `status`. Nothing before this deleted a row: Stage 5a's own commit
 * message said so explicitly ("Stage 5b (deletion) is explicitly deferred,
 * not started"). Deletion is a one-way door in a way status flips are not — a
 * closed posting can be reopened; a deleted one cannot — so it earns its own,
 * later, harder threshold: 30 days CLOSED, not 30 days since posted (that is
 * the freshness floor's own, unrelated meaning — src/lib/jobs/freshness.ts —
 * a posting can be freshness-stale and still open, or freshly-closed and not
 * yet freshness-stale; this job cares about neither, only about `closed_at`).
 *
 * ── WHY THE THRESHOLD IS `closed_at`, NOT `last_checked_at` OR `expires_at` ─
 *
 * See migration 0102's own header for the full reasoning; the short version:
 * `last_checked_at` means a different thing depending which of three closure
 * paths touched it (one bumps it to "now" at closure, one deliberately never
 * touches it, and for an internal posting it means "last edited" long before
 * it means "closed"), and `expires_at` is a fact a source or employer stated,
 * not an observation this system made about its own state. `closed_at` is a
 * new column, stamped at every one of the five places `status` can become
 * `'closed'`, purpose-built so this job has one consistent signal to read.
 *
 * ── WHAT THE FK RULES (0102) MAKE SAFE TO DELETE THROUGH ────────────────────
 *
 *   CASCADE  — match_scores, auto_apply_queue, ad_campaigns, ad_events,
 *              job_posting_reports: rows tied to this posting's existence
 *              specifically, correctly gone with it.
 *   SET NULL — applications.job_posting_id, job_tailoring_requests.
 *              source_job_posting_id, resumes.tailored_for_job_id: rows that
 *              outlive the posting, each carrying its own frozen record of
 *              what it needs (manual_job_snapshot, source_jd_text +
 *              gap_analysis, a plain-string resume title) so losing the FK
 *              loses nothing the user can see.
 *
 * A DELETE this job issues therefore never raises a foreign-key violation for
 * an in-scope referencer — every table pointing at job_postings.id is one of
 * the eight above (checked against 0102's own table, not re-derived here).
 */

export const CLOSED_STALE_AFTER_DAYS = 30;

/**
 * Removes one or more banner files from Storage after their `job_postings`
 * row(s) are already gone. Factored out of the batch sweep below so
 * `deleteJobPosting` (an employer's own direct delete) shares the exact same
 * cleanup — and its exact same failure handling — rather than a second,
 * slightly different copy: a banner Storage remove that silently drops one
 * path, or that throws instead of resolving with `error`, is precisely the
 * kind of drift two independent copies of this logic would eventually grow.
 *
 * LOG AND CONTINUE, deliberately: the row's own deletion is what actually
 * matters, and a Storage hiccup should never hold that up. See the call
 * sites for why a failure here only ever produces an orphaned file (visible
 * on the ops storage panel), never a dangling row.
 */
export async function removeBannerFiles(
  supabase: ReturnType<typeof createServiceRoleClient>,
  bannerPaths: string[],
): Promise<void> {
  if (bannerPaths.length === 0) return;

  const { data: removed, error: storageError } = await supabase.storage
    .from(BANNER_BUCKET)
    .remove(bannerPaths);

  // Checked, never fired and forgotten — a Storage remove that is refused
  // resolves with an error rather than throwing.
  if (storageError) {
    console.error(
      `[job-deletion] ${bannerPaths.length} banner file(s) could NOT be removed and are now ` +
        `orphaned (their postings are deleted, so a re-run will not retry them): ` +
        `${bannerPaths.join(", ")} —`,
      storageError.message,
    );
    return;
  }

  const removedCount = removed?.length ?? 0;
  if (removedCount !== bannerPaths.length) {
    // Partial success is silent otherwise: `remove()` resolves fine when
    // some paths simply were not there.
    console.warn(
      `[job-deletion] asked Storage to remove ${bannerPaths.length} banner(s) but it ` +
        `reported ${removedCount}; the difference was already gone.`,
    );
  }
  console.log(`[job-deletion] removed ${removedCount} banner file(s).`);
}

export type DeleteJobPostingResult =
  | { deleted: true }
  | { deleted: false; reason: "not_found" | "not_closed" | "delete_failed" };

/**
 * An employer's own direct delete of ONE posting — the manual counterpart to
 * `deleteStaleClosedPostings`' 30-day sweep below, for an org that doesn't
 * want to wait a month for a mistaken or unwanted listing to disappear on
 * its own.
 *
 * CLOSED POSTINGS ONLY, enforced HERE, not just in the UI. An open posting
 * can still be actively drawing applicants; the sweep this function's
 * sibling implements never touches anything but a posting that has already
 * been deliberately closed and left that way — the only precedent this
 * codebase has for "how long does someone get to reconsider before a
 * job_postings row is gone for good." Reusing that same gate here means an
 * employer never loses a live listing to a stray click, and costs nothing:
 * Close is one button away, and deleting immediately afterward is exactly as
 * fast as a direct delete would have been. Enforced with `.eq("status",
 * "closed")` on the write itself — not trusted from whatever the caller's
 * own page last rendered — so a request replayed after the posting was
 * reopened in another tab is refused, not raced.
 *
 * Same FK-safety guarantee as the sweep (see this file's own header — same
 * table, same 0102 rules, same cascade/set-null split) and the same banner
 * cleanup (`removeBannerFiles` above) — one copy of "how to safely remove a
 * job_postings row," not two.
 *
 * `organizationId` is checked again here, on the SERVICE-ROLE client, even
 * though the caller (`deleteJobAction`) has already resolved and authorised
 * it through the session client first. Never trust an id alone once past
 * that boundary — the same discipline `claim_external_job_posting` (0128)
 * documents for its own SECURITY DEFINER write, and the same reason
 * `setJobStatusAction` re-asserts `organization_id` on its own update even
 * though RLS would already refuse a cross-org row.
 */
export async function deleteJobPosting(
  supabase: ReturnType<typeof createServiceRoleClient>,
  jobId: string,
  organizationId: string,
): Promise<DeleteJobPostingResult> {
  const { data: job, error: selectError } = await supabase
    .from("job_postings")
    .select("status, banner_path")
    .eq("id", jobId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (selectError || !job) {
    return { deleted: false, reason: "not_found" };
  }
  if (job.status !== "closed") {
    return { deleted: false, reason: "not_closed" };
  }

  const { data: deletedRows, error: deleteError } = await supabase
    .from("job_postings")
    .delete()
    .eq("id", jobId)
    .eq("organization_id", organizationId)
    .eq("status", "closed")
    .select("id");

  // A rejected delete resolves with `error`, it does not throw — checked, per
  // this repo's standing rule. Zero rows (the posting was reopened between
  // the SELECT above and this DELETE) is reported the same way as a real
  // error: either way, nothing was actually removed.
  if (deleteError || !deletedRows?.length) {
    return { deleted: false, reason: "delete_failed" };
  }

  if (job.banner_path) {
    await removeBannerFiles(supabase, [job.banner_path]);
  }

  return { deleted: true };
}

export type PostingDeletionResult = {
  /** How many postings matched the deletion criteria when this run started. */
  eligible: number;
  /** How many were actually removed — see the idempotency note below for why this can be less than `eligible`. */
  deleted: number;
  ids: string[];
  error?: string;
};

export async function deleteStaleClosedPostings(
  now: Date = new Date(),
): Promise<PostingDeletionResult> {
  const supabase = createServiceRoleClient();
  const cutoff = new Date(now.getTime() - CLOSED_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);

  /*
   * Visibility BEFORE deleting anything, and read as its own step rather than
   * inferred from the DELETE's own `.select()` afterward — this repo's own
   * history (CLAUDE.md's "empty or truncated result is a claim" section) is
   * why: a run's log should state what it found as a fact about that run, not
   * assume the count it deleted is the same as the count it faced. The two
   * CAN legitimately differ (see the idempotency note below), and collapsing
   * them into one number would hide that.
   *
   * `.not("closed_at", "is", null)` is belt-and-braces, not a no-op: a
   * closed row with a null closed_at should be structurally impossible after
   * 0102 (every closing write stamps it, and 0102 backfilled every
   * pre-existing closed row), but "structurally impossible today" is not the
   * same guarantee as "asserted here" — this job must never treat an
   * unknown-age row as 30-days-stale by a NULL sorting incorrectly. See
   * closeExpiredInternalPostings for the same defensive pattern.
   */
  const { data: eligibleRows, error: selectError } = await supabase
    .from("job_postings")
    /*
     * `banner_path` alongside `id` (0115). A banner is a Storage object, not a
     * foreign key, so it is invisible to the cascade/set-null reasoning this
     * file's header works through — nothing in the database would ever remove
     * it, and every deleted posting that had one would leave a permanently
     * orphaned file quietly consuming the same free-tier quota the ops page
     * now reports.
     *
     * Read here rather than at delete time because the DELETE's own
     * `.select()` returns rows that are already gone; the path has to be
     * captured while the row still exists.
     */
    .select("id, banner_path")
    .eq("status", "closed")
    .not("closed_at", "is", null)
    .lt("closed_at", cutoff.toISOString());

  if (selectError) {
    console.error("[job-deletion] could not read the eligible set, deleting nothing:", selectError);
    return { eligible: 0, deleted: 0, ids: [], error: selectError.message };
  }

  const eligibleIds = (eligibleRows ?? []).map((row) => row.id);
  /*
   * Only the rows that actually have one. Keyed by posting id so a batch can
   * look up exactly what it deleted rather than re-deriving it.
   */
  const bannerPathById = new Map<string, string>(
    (eligibleRows ?? [])
      .filter((row): row is { id: string; banner_path: string } => !!row.banner_path)
      .map((row) => [row.id, row.banner_path]),
  );

  if (eligibleIds.length === 0) {
    return { eligible: 0, deleted: 0, ids: [] };
  }

  console.log(
    `[job-deletion] ${eligibleIds.length} posting(s) closed before ${cutoff.toISOString()} ` +
      `are eligible for permanent deletion: ${eligibleIds.join(", ")}`,
  );

  /*
   * Batched, the same shape and the same reason as ingest.ts's own
   * CLOSE_BATCH_SIZE: `.in("id", ids)` puts every id in one query string, and
   * a DELETE is no more exempt from that ceiling than the UPDATE it copies
   * this from.
   *
   * Every batch RE-ASSERTS the full predicate rather than trusting the id
   * list alone. That is what makes two overlapping runs (a slow manual
   * trigger and the daily cron landing seconds apart) and a simple re-run
   * both safe: a row already deleted, or reopened by its org between the
   * SELECT above and this DELETE, is excluded by the WHERE clause itself
   * rather than relying on the id list being fresh. This is also the whole
   * idempotency guarantee this job needs — re-running finds the eligible set
   * empty (already gone) or smaller (someone reopened one), never an error.
   */
  const DELETE_BATCH_SIZE = 200;
  let deletedCount = 0;
  const deletedIds: string[] = [];

  for (let i = 0; i < eligibleIds.length; i += DELETE_BATCH_SIZE) {
    const batch = eligibleIds.slice(i, i + DELETE_BATCH_SIZE);
    const { data: deletedRows, error: deleteError } = await supabase
      .from("job_postings")
      .delete()
      .in("id", batch)
      .eq("status", "closed")
      .not("closed_at", "is", null)
      .lt("closed_at", cutoff.toISOString())
      .select("id");

    // A rejected delete resolves with `error`, it does not throw — checked,
    // per this repo's standing rule, because the alternative is a run that
    // logs "deleted" over a batch that was actually refused.
    if (deleteError) {
      console.error(
        `[job-deletion] batch delete FAILED after removing ${deletedCount}/${eligibleIds.length}:`,
        deleteError,
      );
      return {
        eligible: eligibleIds.length,
        deleted: deletedCount,
        ids: deletedIds,
        error: deleteError.message,
      };
    }

    const batchIds = (deletedRows ?? []).map((row) => row.id);
    deletedCount += batchIds.length;
    deletedIds.push(...batchIds);

    /*
     * ── THE BANNER FILES FOR THE ROWS THIS BATCH ACTUALLY DELETED ─────────
     *
     * AFTER the delete, and keyed off `batchIds` rather than off the eligible
     * set, so a posting that was reopened between the SELECT and the DELETE
     * keeps its banner — it still has a row, and the whole point of deleting
     * at 30 days rather than at close time is that a closed posting can come
     * back. Removing artwork from a listing that is alive again would be the
     * regression this timing exists to avoid.
     *
     * LOG AND CONTINUE, NOT BLOCK — a deliberate choice. This function's own
     * contract is "the batch reports how far it got, and a re-run is
     * idempotent", and the DB deletion is the part that actually matters:
     * blocking a row's permanent removal on a Storage hiccup would hold up
     * real cleanup indefinitely for the less important half. The failure mode
     * of continuing is a rare orphaned file, which the ops page's storage
     * panel now makes visible — and which a re-run does NOT fix, since the row
     * is gone, so it is reported loudly rather than left to be inferred from a
     * byte count drifting upward.
     */
    const bannerPaths = batchIds
      .map((id) => bannerPathById.get(id))
      .filter((path): path is string => !!path);

    await removeBannerFiles(supabase, bannerPaths);
  }

  return { eligible: eligibleIds.length, deleted: deletedCount, ids: deletedIds };
}
