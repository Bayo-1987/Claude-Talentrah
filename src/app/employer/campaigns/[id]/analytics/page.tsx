import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEmployer } from "@/lib/employer/membership";
import { getCampaign, getCampaignAnalytics } from "@/lib/employer/campaign-queries";
import { BorderedCard, EyebrowLabel } from "@/components/ui";
import { CampaignStatusBadge, type CampaignStatus } from "@/components/employer/campaign-controls";
import { ctrLabel } from "@/lib/ads/analytics-format";

export const metadata = { title: "Campaign analytics — Talentrah" };

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

/**
 * The read side of the ad funnel (0128) — impressions, clicks, applies, and
 * the CTR they imply, for ONE campaign. `record_ad_event` (0052) has written
 * all three event types since this build; before it, only impressions were
 * ever recorded, so a campaign created before 0128 shipped will show real
 * impressions alongside 0 clicks/applies until it accrues new events, not
 * because nothing happened but because nothing was counted yet.
 *
 * Ownership is resolved by `getCampaignAnalytics` itself, through this
 * request's own session — see that function's own header for why a foreign
 * or wrong campaign id reads as "not found" rather than a page of zeroes.
 */
export default async function CampaignAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organization } = await requireEmployer();

  const [campaign, analytics] = await Promise.all([
    getCampaign(organization.id, id),
    getCampaignAnalytics(organization.id, id),
  ]);
  if (!campaign || !analytics) notFound();

  const status = campaign.status as CampaignStatus;
  const remaining = Math.max(0, campaign.total_budget_ngn - campaign.spent_ngn);

  return (
    <div className="max-w-[820px]">
      <Link
        href={`/employer/campaigns/${campaign.id}`}
        className="font-body text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← {campaign.name}
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <EyebrowLabel>Analytics</EyebrowLabel>
          <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">
            {campaign.name}
          </h1>
          <p className="mt-1 font-body text-[14px] text-ink-soft">
            Promoting {campaign.job_postings?.title ?? "a job that is no longer listed"}
          </p>
        </div>
        <CampaignStatusBadge status={status} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 min-[640px]:grid-cols-4">
        <BorderedCard className="p-4">
          <EyebrowLabel>Impressions</EyebrowLabel>
          <p className="mt-2 font-display text-[26px] text-ink">{analytics.impressions.toLocaleString()}</p>
        </BorderedCard>
        <BorderedCard className="p-4">
          <EyebrowLabel>Clicks</EyebrowLabel>
          <p className="mt-2 font-display text-[26px] text-ink">{analytics.clicks.toLocaleString()}</p>
        </BorderedCard>
        <BorderedCard className="p-4">
          <EyebrowLabel>Applies</EyebrowLabel>
          <p className="mt-2 font-display text-[26px] text-ink">{analytics.applies.toLocaleString()}</p>
        </BorderedCard>
        <BorderedCard className="p-4">
          <EyebrowLabel>CTR</EyebrowLabel>
          <p className="mt-2 font-display text-[26px] text-ink">
            {ctrLabel(analytics.clicks, analytics.impressions)}
          </p>
        </BorderedCard>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 min-[640px]:grid-cols-3">
        <div>
          <dt className="font-body text-[12.5px] text-ink-soft">Spent to date</dt>
          <dd className="font-display text-[19px] text-ink">{naira(campaign.spent_ngn)}</dd>
        </div>
        <div>
          <dt className="font-body text-[12.5px] text-ink-soft">Daily rate</dt>
          <dd className="font-display text-[19px] text-ink">{naira(campaign.daily_rate_ngn)}</dd>
        </div>
        <div>
          <dt className="font-body text-[12.5px] text-ink-soft">Budget left</dt>
          <dd className="font-display text-[19px] text-ink">{naira(remaining)}</dd>
        </div>
      </div>

      {analytics.impressions === 0 && (
        <p className="mt-6 font-body text-[13.5px] text-ink-soft">
          No impressions recorded yet — numbers here fill in as the campaign runs.
        </p>
      )}
    </div>
  );
}
