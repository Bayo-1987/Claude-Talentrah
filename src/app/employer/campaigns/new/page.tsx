import Link from "next/link";
import { requireEmployer } from "@/lib/employer/membership";
import { createCampaignAction } from "@/lib/employer/campaign-actions";
import { listPromotableJobs, getWalletBalance } from "@/lib/employer/campaign-queries";
import { EyebrowLabel } from "@/components/ui";
import { CampaignForm } from "@/components/employer/campaign-form";

export const metadata = { title: "New campaign — Talentrah" };

export default async function NewCampaignPage() {
  const { organization } = await requireEmployer();
  const [jobs, balance] = await Promise.all([
    listPromotableJobs(organization.id),
    getWalletBalance(organization.id),
  ]);

  return (
    <div className="max-w-[820px]">
      <Link
        href="/employer/campaigns"
        className="font-body text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← Ad Campaigns
      </Link>
      <div className="mt-4">
        <EyebrowLabel>New campaign</EyebrowLabel>
        <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">
          Promote a role
        </h1>
        <p className="mt-3 max-w-[60ch] font-body text-[15px] leading-[1.65] text-ink-soft">
          Campaigns are reviewed before they run. Approval is about the ad&apos;s content — it
          doesn&apos;t start the campaign or charge you. You start it yourself once it&apos;s
          approved.
        </p>
      </div>
      <div className="mt-6">
        <CampaignForm
          action={createCampaignAction}
          jobs={jobs}
          walletBalanceNgn={balance}
          submitLabel="Create draft"
          pendingLabel="Creating…"
        />
      </div>
    </div>
  );
}
