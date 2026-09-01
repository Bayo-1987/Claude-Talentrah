import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { computeScholarshipFingerprint } from "./dedup";
import { SEED_SCHOLARSHIPS } from "./sources.config";
import type { NormalizedScholarship } from "./types";

export interface ScholarshipIngestSummary {
  ok: boolean;
  fetched: number;
  upserted: number;
  /**
   * Listings that were published and whose content changed in this pass, so
   * they went back to `pending`. Reported because it is the one number in this
   * summary that means "a human has something to do" — a run that silently
   * unpublished six listings should not read the same as a quiet one.
   */
  returnedToReview: number;
  staleMarked: number;
  errors: string[];
}

/** Listings whose deadline passed this long ago stop being re-surfaced. */
const STALE_AFTER_DAYS = 1;

async function fetchAllSources(): Promise<NormalizedScholarship[]> {
  // Only a curated source for now — see sources.config.ts for why a live
  // scraper is deliberately out of M10's scope (§10 item 19's legal review).
  // A real fetch-based source slots in here without the rest of this file
  // changing, exactly like src/lib/jobs/ingest.ts's fetchSource.
  return SEED_SCHOLARSHIPS;
}

export interface ScholarshipUpsertResult {
  /** Rows written — created or updated. */
  upserted: number;
  /**
   * Fingerprints of listings that were `verified` and whose content changed,
   * so they were sent back for review. Surfaced rather than merely logged: the
   * seed pipeline reports it in its summary, and it is the one outcome of an
   * upsert that a human needs to act on.
   */
  returnedToReview: string[];
  /** Non-null when the write failed. The caller decides how loud that is. */
  error: string | null;
}

/**
 * The columns that describe the listing itself — what a seeker reads and acts
 * on. A change to any of them is what sends a published listing back for
 * review.
 *
 * Kept as an explicit list rather than derived from the row, because it also
 * has to be a PostgREST select string. `scholarshipRow` and this list have to
 * stay in step; tests/scholarships/upsert-content.test.ts asserts that every
 * key the writer writes appears in exactly one of these two lists, so adding a
 * column without deciding which it is fails there rather than silently
 * becoming invisible to the diff.
 */
export const CONTENT_COLUMNS = [
  "provider",
  "program_name",
  "host_institution",
  "degree_levels",
  "field_tags",
  "funding_type",
  "funding_covers",
  "eligibility_nationalities",
  "eligibility_prior_degree",
  "eligibility_age",
  "eligibility_other",
  "application_deadline",
  "cycle_year",
  "official_url",
  "source_name",
  "deadline_verified_at",
  "deadline_note",
] as const;

/**
 * Written, but not part of the listing's content.
 *
 * `dedup_fingerprint` is identity — it cannot differ, it is what matched.
 * `last_checked_at`/`updated_at` change on every single pass, so including
 * either would send every listing back for review on every run.
 * `moderation_note` is the reviewer's own record, not the listing: editing a
 * note about a listing is not editing the listing.
 */
export const NON_CONTENT_COLUMNS = [
  "dedup_fingerprint",
  "last_checked_at",
  "updated_at",
  "moderation_note",
] as const;

/**
 * Columns whose values are timestamps, compared as instants rather than text.
 *
 * This is not defensive tidiness, it is the difference between working and
 * quietly breaking: we send `2026-01-15T00:00:00.000Z` and Postgres hands back
 * `2026-01-15 00:00:00+00`. As strings those differ, so a text comparison
 * would find a change in `deadline_verified_at` on every run and park every
 * verified listing in the review queue permanently.
 */
const TIMESTAMP_COLUMNS = new Set<string>(["deadline_verified_at"]);

/** Row shape for one listing. Exported so a test can check its keys. */
export function scholarshipRow(
  listing: NormalizedScholarship,
  fingerprint: string,
  now: string,
) {
  return {
    provider: listing.provider,
    program_name: listing.programName,
    host_institution: listing.hostInstitution,
    degree_levels: listing.degreeLevels,
    field_tags: listing.fieldTags,
    funding_type: listing.fundingType,
    funding_covers: listing.fundingCovers,
    eligibility_nationalities: listing.eligibilityNationalities,
    eligibility_prior_degree: listing.eligibilityPriorDegree,
    eligibility_age: listing.eligibilityAge,
    eligibility_other: listing.eligibilityOther,
    application_deadline: listing.applicationDeadline,
    cycle_year: listing.cycleYear,
    official_url: listing.officialUrl,
    source_name: listing.sourceName,
    deadline_verified_at: listing.deadlineVerifiedAt,
    // Two different audiences, two different columns: deadline_note is what
    // the applicant reads in place of a date when the provider genuinely
    // has no single one; moderation_note is the reviewer's record of what
    // the source check turned up.
    deadline_note: listing.deadlineNote,
    ...(listing.reviewNote ? { moderation_note: listing.reviewNote } : {}),
    dedup_fingerprint: fingerprint,
    // §6.15's freshness requirement: every pass records that the listing
    // was seen again, so a reviewer can tell a re-confirmed listing from
    // one nobody has looked at in months.
    last_checked_at: now,
    updated_at: now,
  };
}

/** A comparable form for one column's value, null distinguishable from "". */
function comparable(column: string, value: unknown): string {
  if (value === null || value === undefined) return "\u0000null";
  if (TIMESTAMP_COLUMNS.has(column)) {
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? String(value) : String(parsed);
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

/** Which content columns differ between what we are about to write and the stored row. */
function changedColumns(
  row: Record<string, unknown>,
  existing: Record<string, unknown>,
): string[] {
  return CONTENT_COLUMNS.filter(
    (column) => comparable(column, row[column]) !== comparable(column, existing[column]),
  );
}

/**
 * Writes normalized listings to `scholarships`, keyed on the dedup
 * fingerprint. The one path anything takes to create a scholarship row.
 *
 * Extracted from `ingestScholarships` so the by-hand admin path writes
 * through exactly the same code rather than a second, similar-looking one.
 * (That path was the route src/app/api/admin/scholarships/route.ts; it is now
 * `createScholarshipAction`, which still calls straight into here.) The dedup key, the
 * within-batch collapse and the moderation rules below are all things a
 * parallel implementation would have to remember, and getting them right in
 * one place and wrong in the other is the failure this prevents.
 *
 * ── The moderation gate ───────────────────────────────────────────────────
 *
 * Nothing here can publish a listing. There are exactly three outcomes:
 *
 *   NEW ROW            → takes the column default, `pending`.
 *   COLLISION, SAME    → content identical to what is stored; the row's status
 *                        is left exactly as it is. A verified listing stays
 *                        verified, which is what makes a nightly re-ingest a
 *                        no-op rather than a queue flood.
 *   COLLISION, CHANGED → if the stored row was `verified`, it goes back to
 *                        `pending`.
 *
 * That third case is the point. `verified` is a claim that a human checked
 * *this* listing, and an upsert that rewrites the deadline or the award while
 * leaving the badge in place turns it into a claim about content nobody has
 * read. It matters more here than for a job posting because a seeker acts
 * directly on these fields — a wrong deadline is a missed application. The
 * same admin secret can re-verify immediately, so this adds no gate that did
 * not already exist; it only stops the badge outliving what it describes.
 *
 * Deliberately narrow in two ways. A `rejected` row is not resurrected by a
 * content change — someone decided that, and an edit is not an appeal. And
 * `pending` rows are already in the queue, so there is nothing to do.
 */
export async function upsertScholarships(
  listings: NormalizedScholarship[],
): Promise<ScholarshipUpsertResult> {
  if (listings.length === 0) return { upserted: 0, returnedToReview: [], error: null };

  const supabase = createServiceRoleClient();

  // Collapse within-batch collisions before the upsert — ON CONFLICT DO
  // UPDATE can't touch the same row twice in one command (same guard the
  // jobs pipeline needs).
  const deduped = Array.from(
    new Map(
      listings.map((listing) => [
        computeScholarshipFingerprint(listing.provider, listing.programName, listing.cycleYear),
        listing,
      ]),
    ).entries(),
  );

  const now = new Date().toISOString();
  const baseRows = deduped.map(([fingerprint, listing]) =>
    scholarshipRow(listing, fingerprint, now),
  );

  /*
   * Read before writing, which the previous version did not have to do.
   *
   * A bare upsert cannot express "leave the status alone unless the content
   * moved" — it either writes the column or it does not, and it cannot see
   * what was there. So the stored content comes back first and the decision
   * is made per row.
   *
   * The race this leaves: a reviewer verifying a listing between this read and
   * the upsert would have their decision made against content this write then
   * replaces. That window is milliseconds, both actors are trusted operators,
   * and the failure mode is a listing showing as verified until the next
   * ingest re-reads it and sends it back. Worth naming; not worth a lock.
   */
  const { data: storedRows, error: readError } = await supabase
    .from("scholarships")
    .select(`dedup_fingerprint, moderation_status, ${CONTENT_COLUMNS.join(", ")}`)
    .in(
      "dedup_fingerprint",
      baseRows.map((row) => row.dedup_fingerprint),
    );

  if (readError) return { upserted: 0, returnedToReview: [], error: readError.message };

  const stored = new Map(
    (storedRows ?? []).map((row) => [
      (row as unknown as { dedup_fingerprint: string }).dedup_fingerprint,
      row as unknown as Record<string, unknown>,
    ]),
  );

  const returnedToReview: string[] = [];
  const rows = baseRows.map((row) => {
    const existing = stored.get(row.dedup_fingerprint);
    if (!existing || existing.moderation_status !== "verified") return row;

    const changed = changedColumns(row, existing);
    if (changed.length === 0) return row;

    returnedToReview.push(row.dedup_fingerprint);
    const reason = `Returned for review: ${changed.join(", ")} changed after verification.`;
    return {
      ...row,
      moderation_status: "pending" as const,
      moderated_at: null,
      // The reviewer's existing note is replaced, because what they need to
      // see first is why this is back in the queue. Any note the submission
      // carried is kept alongside rather than dropped.
      moderation_note: row.moderation_note ? `${reason} ${row.moderation_note}` : reason,
    };
  });

  const { error, count } = await supabase
    .from("scholarships")
    .upsert(rows, { onConflict: "dedup_fingerprint", count: "exact" });

  if (error) return { upserted: 0, returnedToReview: [], error: error.message };
  return { upserted: count ?? rows.length, returnedToReview, error: null };
}

/**
 * Runs scholarship ingestion. Not on any user-facing request path
 * (build-prompt §8's "aggregation pipeline runs as background jobs") — call
 * from the authenticated admin trigger at
 * src/app/api/admin/ingest-scholarships/route.ts.
 *
 * Deliberately a parallel module to src/lib/jobs/ingest.ts rather than a
 * shared code path: the dedup key, the freshness rules and — most of all —
 * the moderation gate are genuinely different, and merging them would mean
 * one pipeline carrying branches for both.
 *
 * Note what this does NOT do: it never sets moderation_status. New rows get
 * the column default (`pending`), and re-ingesting an existing listing
 * leaves whatever a human reviewer already decided untouched. Ingestion
 * cannot publish anything (§6.15).
 */
export async function ingestScholarships(): Promise<ScholarshipIngestSummary> {
  const summary: ScholarshipIngestSummary = {
    ok: true,
    fetched: 0,
    upserted: 0,
    returnedToReview: 0,
    staleMarked: 0,
    errors: [],
  };
  const supabase = createServiceRoleClient();

  let listings: NormalizedScholarship[];
  try {
    listings = await fetchAllSources();
  } catch (err) {
    summary.ok = false;
    summary.errors.push(err instanceof Error ? err.message : "Unknown fetch error");
    return summary;
  }
  summary.fetched = listings.length;

  const written = await upsertScholarships(listings);
  if (written.error) {
    summary.ok = false;
    summary.errors.push(`Upsert failed: ${written.error}`);
    return summary;
  }
  summary.upserted = written.upserted;
  summary.returnedToReview = written.returnedToReview.length;

  summary.staleMarked = await markExpiredCycles(supabase, summary);
  return summary;
}

/**
 * §6.15: "re-check listings on a schedule to catch closed/expired cycles
 * rather than leaving them live." A passed deadline is the one unambiguous
 * expiry signal available without re-fetching each page, so it flips the
 * listing back out of the published set rather than leaving a dead cycle
 * in front of users. Rejecting rather than deleting keeps the row (and its
 * saves) intact for the next cycle's re-ingest.
 */
async function markExpiredCycles(
  supabase: ReturnType<typeof createServiceRoleClient>,
  summary: ScholarshipIngestSummary,
): Promise<number> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - STALE_AFTER_DAYS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("scholarships")
    .update({ moderation_status: "rejected", moderation_note: "Cycle deadline passed." })
    .eq("moderation_status", "verified")
    .not("application_deadline", "is", null)
    .lt("application_deadline", cutoffDate)
    .select("id");

  if (error) {
    summary.ok = false;
    summary.errors.push(`Expiry sweep failed: ${error.message}`);
    return 0;
  }
  return data?.length ?? 0;
}

/**
 * The moderation gate's write side (§6.15). Service-role only — there is
 * deliberately no RLS policy letting an authenticated user update
 * scholarships, so this is the single path that can publish a listing.
 */
export async function setModerationStatus(
  scholarshipId: string,
  status: "pending" | "verified" | "rejected",
  note?: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("scholarships")
    .update({
      moderation_status: status,
      moderation_note: note ?? null,
      moderated_at: new Date().toISOString(),
    })
    .eq("id", scholarshipId);
  if (error) throw error;
}
