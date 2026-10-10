/**
 * Is a posting "apply on someone else's page"? ONE definition for every surface (Employer job import, plan reports/S1/2026-10-08-employer-job-import-plan.md).
 *
 * An EXTERNAL posting (aggregated from a job board) is always link-out. An IMPORTED posting (import_feed_id set, 0246) is stored as an `internal` row of the employer's verified organisation so the
 * verified-organisation gate applies by itself, but the application happens on the employer's OWN site: it is link-out too. Any surface that treats `source_type === "internal"` as "applied for
 * inside Talentrah" (an Apply button, Auto-Apply, an applicant count, a JSON-LD directApply, an expiry reminder) must ask this instead, or an imported job would make a seeker believe they
 * applied while the employer received nothing. tests/jobs/link-out-surfaces.test.ts fails on any file under src/ that reads source_type without importing this module or sitting on its short,
 * reviewed allowlist.
 */
export interface LinkOutFields {
  source_type: string;
  /** Set on an imported posting (0246). Absent or null on every other posting. */
  import_feed_id?: string | null;
}

export function isLinkOutPosting(job: LinkOutFields): boolean {
  return job.source_type === "external" || (job.import_feed_id ?? null) !== null;
}

/** True only for a posting that is imported from an employer's feed. */
export function isImportedPosting(job: Pick<LinkOutFields, "import_feed_id">): boolean {
  return (job.import_feed_id ?? null) !== null;
}

/**
 * The value stored in auto_apply_queue.source_type. auto_apply_claim_submission decides "hand off or submit" from that column (`source_type = 'external'` hands off), so it must hold the posting's
 * real APPLY MODE: 'external' for anything link-out, 'internal' only for a posting the seeker can really apply to inside Talentrah.
 */
export function queueSourceType(job: LinkOutFields): "internal" | "external" {
  return isLinkOutPosting(job) ? "external" : "internal";
}

/**
 * The provenance line a seeker sees: where the posting really comes from. An aggregated posting says "sourced externally" (the word the signed-in card has always used); an IMPORTED posting says
 * "Posted on {Company}'s own site" (the employer published it themselves and applications go to them); an ordinary Talentrah posting has no provenance line on the card (null).
 */
export function provenanceLabel(job: LinkOutFields & { company_name: string }): string | null {
  if (job.source_type === "external") return "sourced externally";
  if (isImportedPosting(job)) return `Posted on ${job.company_name}'s own site`;
  return null;
}
