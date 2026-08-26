import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEmployer } from "@/lib/employer/membership";
import {
  getCampaign,
  listPromotableJobs,
  getWalletBalance,
} from "@/lib/employer/campaign-queries";
import {
  updateCampaignAction,
  submitCampaignForReviewAction,
  pauseCampaignAction,
  resumeCampaignAction,
} from "@/lib/employer/campaign-actions";
import { BorderedCard, EyebrowLabel } from "@/components/ui";
import { CampaignForm } from "@/components/employer/campaign-form";
import {
  CampaignControls,
  CampaignStatusBadge,
  CampaignStatusBlurb,
  type CampaignStatus,
} from "@/components/employer/campaign-controls";

export const metadata = { title: "Campaign — Talentrah" };

const naira = (n: number) => `₦${n.toLocaleString("en-NG")}`;

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organization } = await requireEmployer();
  const campaign = await getCampaign(organization.id, id);
  if (!campaign) notFound();

  const status = campaign.status as CampaignStatus;
  // Editable only while the DB says it is: 0047's UPDATE policy restricts
  // writes to drafts, so offering the form in any other state would be
  // offering something that fails on submit.
  const editable = status === "draft" || status === "rejected";
  const [jobs, balance] = await Promise.all([
    listPromotableJobs(organization.id),
    getWalletBalance(organization.id),
  ]);

  // The promoted job may be closed by now, in which case it is missing from
  // `jobs` — add it back so the locked field can still name it.
  const jobsForForm = jobs.some((j) => j.id === campaign.job_posting_id)
    ? jobs
    : [
        ...jobs,
        { id: campaign.job_posting_id, title: campaign.job_postings?.title ?? "Closed job" },
      ];

  const remaining = Math.max(0, campaign.total_budget_ngn - campaign.spent_ngn);
  const daysLeft =
    campaign.daily_rate_ngn > 0 ? Math.floor(remaining / campaign.daily_rate_ngn) : 0;

  return (
    <div className="max-w-[820px]">
      <Link
        href="/employer/campaigns"
        className="font-body text-[13px] font-semibold text-ink-soft no-underline hover:text-rust"
      >
        ← Ad Campaigns
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <EyebrowLabel>Campaign</EyebrowLabel>
          <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">
            {campaign.name}
          </h1>
          <p className="mt-1 font-body text-[14px] text-ink-soft">
            Promoting {campaign.job_postings?.title ?? "a job that is no longer listed"}
          </p>
        </div>
        <CampaignStatusBadge status={status} />
      </div>

      <div className="mt-5 flex flex-col gap-4 border-y border-line py-5">
        <CampaignStatusBlurb status={status} />
        {status === "rejected" && campaign.review_note && (
          <BorderedCard className="p-4">
            <EyebrowLabel>What to change</EyebrowLabel>
            <p className="mt-2 font-body text-[14.5px] leading-[1.6] text-ink">
              {campaign.review_note}
            </p>
          </BorderedCard>
        )}
        <dl className="grid grid-cols-2 gap-4 min-[640px]:grid-cols-4">
          <div>
            <dt className="font-body text-[12.5px] text-ink-soft">Daily</dt>
            <dd className="font-display text-[19px] text-ink">{naira(campaign.daily_rate_ngn)}</dd>
          </div>
          <div>
            <dt className="font-body text-[12.5px] text-ink-soft">Spent</dt>
            <dd className="font-display text-[19px] text-ink">{naira(campaign.spent_ngn)}</dd>
          </div>
          <div>
            <dt className="font-body text-[12.5px] text-ink-soft">Budget left</dt>
            <dd className="font-display text-[19px] text-ink">
              {naira(remaining)}
              <span className="ml-1 font-body text-[13px] text-ink-soft">
                ({daysLeft} {daysLeft === 1 ? "day" : "days"})
              </span>
            </dd>
          </div>
          <div>
            <dt className="font-body text-[12.5px] text-ink-soft">Ad wallet</dt>
            <dd className="font-display text-[19px] text-ink">{naira(balance)}</dd>
          </div>
        </dl>
        <CampaignControls
          status={status}
          submitForReview={submitCampaignForReviewAction.bind(null, campaign.id)}
          pause={pauseCampaignAction.bind(null, campaign.id)}
          resume={resumeCampaignAction.bind(null, campaign.id)}
        />
      </div>

      {editable && (
        <div className="mt-8">
          <EyebrowLabel>Edit campaign</EyebrowLabel>
          <div className="mt-3">
            <CampaignForm
              action={updateCampaignAction.bind(null, campaign.id)}
              jobs={jobsForForm}
              jobLocked
              walletBalanceNgn={balance}
              initial={{
                name: campaign.name,
                jobPostingId: campaign.job_posting_id,
                dailyRateNgn: campaign.daily_rate_ngn,
                totalBudgetNgn: campaign.total_budget_ngn,
                endsOn: campaign.ends_on,
                targetLocations: campaign.target_locations,
              }}
              submitLabel="Save changes"
              pendingLabel="Saving…"
            />
          </div>
        </div>
      )}
    </div>
  );
}
