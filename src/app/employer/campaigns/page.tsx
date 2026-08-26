import Link from "next/link";
import { requireEmployer } from "@/lib/employer/membership";
import { listCampaigns, getWalletBalance } from "@/lib/employer/campaign-queries";
import { BorderedCard, Button, EyebrowLabel } from "@/components/ui";
import { CampaignStatusBadge, type CampaignStatus } from "@/components/employer/campaign-controls";
import { WalletTopUp } from "@/components/employer/wallet-topup";
import { topUpWalletAction } from "@/lib/employer/wallet-actions";

export const metadata = { title: "Ad Campaigns — Talentrah" };

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

export default async function CampaignsPage() {
  const { organization } = await requireEmployer();
  const [campaigns, balance] = await Promise.all([
    listCampaigns(organization.id),
    getWalletBalance(organization.id),
  ]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <EyebrowLabel>Promoted roles</EyebrowLabel>
          <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">
            Ad Campaigns
          </h1>
        </div>
        <Link href="/employer/campaigns/new" className="no-underline">
          <Button>New campaign</Button>
        </Link>
      </div>

      <div className="mt-6">
        <WalletTopUp
          action={topUpWalletAction}
          balanceNgn={balance}
          dailyCommitmentNgn={campaigns
            .filter((c) => c.status === "active")
            .reduce((sum, c) => sum + c.daily_rate_ngn, 0)}
        />
      </div>

      {campaigns.length === 0 ? (
        <BorderedCard className="mt-6 p-6">
          <p className="font-body text-[15px] leading-[1.6] text-ink">
            No campaigns yet. A campaign promotes one of your open jobs higher in the seeker feed,
            charged once for each day it runs.
          </p>
        </BorderedCard>
      ) : (
        <ul className="mt-6 list-none p-0">
          {campaigns.map((c) => (
            <li key={c.id} className="border-b border-line py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link
                    href={`/employer/campaigns/${c.id}`}
                    className="font-display text-[19px] font-semibold text-ink no-underline hover:text-rust"
                  >
                    {c.name}
                  </Link>
                  <p className="mt-1 font-body text-[13.5px] text-ink-soft">
                    {c.job_postings?.title ?? "Job no longer listed"} · {naira(c.daily_rate_ngn)}
                    /day
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <CampaignStatusBadge status={c.status as CampaignStatus} />
                  <span className="font-body text-[13px] text-ink-soft">
                    {naira(c.spent_ngn)} of {naira(c.total_budget_ngn)} spent
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
