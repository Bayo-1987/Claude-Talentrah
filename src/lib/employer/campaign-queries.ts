import { createClient } from "@/lib/supabase/server";

/**
 * Reads for the campaign screens. All go through the USER's client so the RLS
 * policies answer — a member of another organisation gets an empty result
 * rather than a 403 the UI would have to special-case.
 */

export interface CampaignRow {
  id: string;
  name: string;
  status: string;
  daily_rate_ngn: number;
  total_budget_ngn: number;
  spent_ngn: number;
  ends_on: string | null;
  last_charged_on: string | null;
  review_note: string | null;
  target_locations: string[] | null;
  job_posting_id: string;
  job_postings: { title: string } | null;
}

const CAMPAIGN_FIELDS =
  "id, name, status, daily_rate_ngn, total_budget_ngn, spent_ngn, ends_on, " +
  "last_charged_on, review_note, target_locations, job_posting_id, job_postings(title)";

export async function listCampaigns(organizationId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ad_campaigns")
    .select(CAMPAIGN_FIELDS)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as CampaignRow[];
}

export async function getCampaign(organizationId: string, id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ad_campaigns")
    .select(CAMPAIGN_FIELDS)
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as unknown as CampaignRow | null;
}

/**
 * Jobs this organisation can promote.
 *
 * Filtered to `open` because promoting a closed role spends money sending
 * seekers to something they cannot apply to — the worst possible thing to
 * charge for.
 */
export async function listPromotableJobs(organizationId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("job_postings")
    .select("id, title")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .order("created_at", { ascending: false });
  return (data ?? []) as { id: string; title: string }[];
}

/**
 * Wallet balance, or 0 when no wallet row exists yet.
 *
 * Zero is the honest default rather than an error state: an organisation that
 * has never topped up genuinely has nothing to spend, and the resume path
 * checks the real balance in Postgres anyway. This number is for display only
 * — never gate on it.
 */
export async function getWalletBalance(organizationId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ad_wallets")
    .select("balance_ngn")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return data?.balance_ngn ?? 0;
}
