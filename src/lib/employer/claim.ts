import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * "Claim your listing" (build-prompt §6.12) — reading the candidate list.
 *
 * The actual claim (creating the new internal posting and marking the
 * external one) is `claim_external_job_posting`, a service-role-only RPC —
 * see `claimJobPostingAction` in ./actions.ts and 0128's own migration header
 * for why that one needs elevated rights and this one does not.
 *
 * This module is deliberately thin: `job_posting_claim_candidates` (0128) is
 * `security invoker` and reads only rows that are already publicly readable
 * (an open external posting, a public `organizations` row), so there is
 * nothing here to re-implement in TypeScript — no privilege check, no
 * fallback, just the RPC call and a typed shape for the result.
 */

export type ClaimConfidence = "domain" | "name";

export interface ClaimCandidate {
  id: string;
  title: string;
  location: string | null;
  companyName: string;
  externalUrl: string | null;
  externalSource: string | null;
  postedAt: string;
  /**
   * "domain" = the posting's external_url hostname matches the organisation's
   * verified domain — high confidence. "name" = only the company name
   * matched, normalised — a weaker signal, presented to the employer as a
   * suggestion rather than a fact (see 0128's header on why these are not
   * treated the same).
   */
  confidence: ClaimConfidence;
}

/**
 * External postings that might belong to `organizationId`. Empty for an org
 * with no verified domain and no name match — never throws on "nothing
 * found," only on a real query failure, matching this repo's own convention
 * that an error is not an absence (membership.ts's own header).
 */
export async function getClaimCandidates(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<ClaimCandidate[]> {
  const { data, error } = await supabase.rpc("job_posting_claim_candidates", {
    p_organization_id: organizationId,
  });
  if (error) {
    throw new Error(`Couldn't look for postings that might be yours: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    location: row.location,
    companyName: row.company_name,
    externalUrl: row.external_url,
    externalSource: row.external_source,
    postedAt: row.posted_at,
    confidence: row.confidence === "domain" ? "domain" : "name",
  }));
}
