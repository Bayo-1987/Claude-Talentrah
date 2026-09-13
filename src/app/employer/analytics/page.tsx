import Link from "next/link";
import { requireEmployer } from "@/lib/employer/membership";
import { listCampaigns, getCampaignAnalytics } from "@/lib/employer/campaign-queries";
import { Card, EyebrowLabel } from "@/components/ui";
import { CampaignStatusBadge, type CampaignStatus } from "@/components/employer/campaign-controls";
import { ctrLabel } from "@/lib/ads/analytics-format";

export const metadata = { title: "Analytics — Talentrah" };

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

/**
 * The nav-level "Analytics" landing (0128) — CLAUDE.md's own §5 nav list
 * carries it as its own top-level entry, distinct from "Ad Campaigns", which
 * is why this is `/employer/analytics` rather than nested under
 * `/employer/campaigns`: a nested href would satisfy `pathname?.startsWith`
 * for BOTH nav links at once and show them both as active while looking at
 * this page.
 *
 * "Ad Campaigns" stays the place to create, edit, pause and resume a
 * campaign; this page is read-only, across every campaign the org has ever
 * run, one row each — the per-campaign breakdown behind "View analytics"
 * covers the DAILY spend/budget figures already shown there instead of
 * repeating them here.
 */
export default async function EmployerAnalyticsPage() {
  const { organization } = await requireEmployer();
  const campaigns = await listCampaigns(organization.id);

  const rows = await Promise.all(
    campaigns.map(async (c) => ({
      campaign: c,
      analytics: (await getCampaignAnalytics(organization.id, c.id)) ?? {
        impressions: 0,
        clicks: 0,
        applies: 0,
      },
    })),
  );

  const totals = rows.reduce(
    (acc, r) => ({
      impressions: acc.impressions + r.analytics.impressions,
      clicks: acc.clicks + r.analytics.clicks,
      applies: acc.applies + r.analytics.applies,
      spent: acc.spent + r.campaign.spent_ngn,
    }),
    { impressions: 0, clicks: 0, applies: 0, spent: 0 },
  );

  return (
    <div className="max-w-[960px]">
      <EyebrowLabel>Every campaign, one place</EyebrowLabel>
      <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">Analytics</h1>

      {campaigns.length === 0 ? (
        <p className="mt-6 font-body text-[14.5px] text-ink-soft">
          No campaigns yet —{" "}
          <Link href="/employer/campaigns/new" className="text-ink underline hover:text-coral">
            create your first one
          </Link>{" "}
          to start seeing impressions, clicks and applies here.
        </p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 min-[640px]:grid-cols-4">
            <Card className="p-4">
              <EyebrowLabel>Impressions</EyebrowLabel>
              <p className="mt-2 font-display text-[24px] text-ink">{totals.impressions.toLocaleString()}</p>
            </Card>
            <Card className="p-4">
              <EyebrowLabel>Clicks</EyebrowLabel>
              <p className="mt-2 font-display text-[24px] text-ink">{totals.clicks.toLocaleString()}</p>
            </Card>
            <Card className="p-4">
              <EyebrowLabel>Applies</EyebrowLabel>
              <p className="mt-2 font-display text-[24px] text-ink">{totals.applies.toLocaleString()}</p>
            </Card>
            <Card className="p-4">
              <EyebrowLabel>Spent to date</EyebrowLabel>
              <p className="mt-2 font-display text-[24px] text-ink">{naira(totals.spent)}</p>
            </Card>
          </div>

          <div className="mt-8 flex flex-col divide-y divide-line border-y border-line">
            {rows.map(({ campaign, analytics }) => (
              <div
                key={campaign.id}
                className="flex flex-col gap-3 py-4 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <p className="truncate font-body text-[14.5px] font-semibold text-ink">{campaign.name}</p>
                    <CampaignStatusBadge status={campaign.status as CampaignStatus} />
                  </div>
                  <p className="mt-0.5 truncate font-body text-[12.5px] text-ink-soft">
                    {campaign.job_postings?.title ?? "a job that is no longer listed"}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-5 font-body text-[13px] text-ink-soft">
                  <span>{analytics.impressions.toLocaleString()} impressions</span>
                  <span>{analytics.clicks.toLocaleString()} clicks</span>
                  <span>{analytics.applies.toLocaleString()} applies</span>
                  <span>{ctrLabel(analytics.clicks, analytics.impressions)} CTR</span>
                  <Link
                    href={`/employer/campaigns/${campaign.id}/analytics`}
                    className="font-semibold text-ink underline underline-offset-2 hover:text-coral"
                  >
                    Details
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
