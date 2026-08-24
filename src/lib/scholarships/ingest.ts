import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { computeScholarshipFingerprint } from "./dedup";
import { SEED_SCHOLARSHIPS } from "./sources.config";
import type { NormalizedScholarship } from "./types";

export interface ScholarshipIngestSummary {
  ok: boolean;
  fetched: number;
  upserted: number;
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

  const rows = deduped.map(([fingerprint, listing]) => ({
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
    // deadlineNote is reviewer-facing context for why a date is missing;
    // it rides on moderation_note so it lands where a reviewer looks,
    // without adding a second near-identical column.
    ...(listing.deadlineNote ? { moderation_note: listing.deadlineNote } : {}),
    dedup_fingerprint: fingerprint,
    // §6.15's freshness requirement: every pass records that the listing
    // was seen again, so a reviewer can tell a re-confirmed listing from
    // one nobody has looked at in months.
    last_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertError, count } = await supabase
    .from("scholarships")
    .upsert(rows, { onConflict: "dedup_fingerprint", count: "exact" });

  if (upsertError) {
    summary.ok = false;
    summary.errors.push(`Upsert failed: ${upsertError.message}`);
    return summary;
  }
  summary.upserted = count ?? rows.length;

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
