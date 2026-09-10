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

export interface CampaignAnalytics {
  impressions: number;
  clicks: number;
  applies: number;
}

/**
 * Impression/click/apply counts for ONE campaign (0128) — the read side of
 * the funnel `record_ad_event` (0052) writes. Goes through the CALLER'S
 * session, same as every other query in this file: `ad_events`' own RLS
 * policy ("org members read their own campaign events", 0052) is what
 * actually stops one organisation from reading another's numbers — this
 * function adds no access of its own, per the task's own instruction that
 * none is needed.
 *
 * The `organizationId`/`campaignId` pair is checked against `ad_campaigns`
 * FIRST, through the same session, for the same reason `getCampaign` above
 * does it: a wrong or foreign id should read as "not found", not as three
 * queries that happen to return zero because RLS silently hid every event
 * row. Without this check, a foreign campaign id would look identical to a
 * real campaign that simply has no events yet — the exact ambiguity this
 * file's other functions already avoid.
 *
 * Three separate counted queries rather than one aggregate read: Supabase's
 * client has no GROUP BY, and a real organisation runs a small number of
 * campaigns — three `count: "exact", head: true` reads per campaign is cheap
 * at that scale and needs no new SQL function. Revisit if a campaign's event
 * volume ever makes this worth a dedicated aggregate.
 */
export async function getCampaignAnalytics(
  organizationId: string,
  campaignId: string,
): Promise<CampaignAnalytics | null> {
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("ad_campaigns")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign) return null;

  const countFor = (eventType: "impression" | "click" | "apply") =>
    supabase
      .from("ad_events")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("event_type", eventType);

  const [impressions, clicks, applies] = await Promise.all([
    countFor("impression"),
    countFor("click"),
    countFor("apply"),
  ]);

  return {
    impressions: impressions.count ?? 0,
    clicks: clicks.count ?? 0,
    applies: applies.count ?? 0,
  };
}
