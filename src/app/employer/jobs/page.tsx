import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireEmployer } from "@/lib/employer/membership";
import { BorderedCard, EyebrowLabel, buttonClasses } from "@/components/ui";
import { PostedJobRow, type PostedJob } from "@/components/employer/posted-job-row";
import { EmployerJobShareInline } from "@/components/employer/job-share-button";
import { PostSuccessBannerNote } from "@/components/employer/post-success-banner-note";
import { getJobShareVisibility } from "@/lib/employer/job-visibility";
import { evaluateDomainVerification, employerBannerMessage } from "@/lib/employer/verification";
import { mintUnlistedLink } from "@/lib/employer/mint-unlisted-link";
import { getClaimCandidates } from "@/lib/employer/claim";
import { dismissClaimReviewAction } from "@/lib/employer/actions";
import { getSiteOrigin } from "@/lib/referrals/url";

export const metadata = { title: "Jobs Posted — Talentrah" };

type SearchParams = Promise<{ posted?: string; claimed?: string; deleted?: string; error?: string }>;

export default async function JobsPostedPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { organization, userId, userEmail, emailConfirmed } = await requireEmployer();
  const { posted, claimed, deleted, error: actionError } = await searchParams;
  const supabase = await createClient();
  const origin = await getSiteOrigin();

  // "Claim your listing" (0128/0129): only worth checking for a VERIFIED
  // org — job_posting_claim_candidates matches against the verified
  // domain/name, so an unverified org would only ever see a name-only
  // false-positive list, and the Company Profile banner above already tells
  // it to verify first. Also skipped once the org has dismissed the banner —
  // dismissClaimReviewAction is a one-way "stop asking," not a snooze, so a
  // dismissed org never has claimCandidateCount computed again on this page.
  const claimCandidateCount =
    organization.verified && !organization.claim_review_dismissed_at
      ? (await getClaimCandidates(supabase, organization.id).catch(() => [])).length
      : 0;

  const [{ data: jobs, error: jobsError }, { data: counts, error: countsError }] =
    await Promise.all([
      supabase
        .from("job_postings")
        .select(
          "id, title, location, status, posted_at, work_type, employment_type, removal_reason, unlisted_at, admin_review_requested_at, admin_review_decision",
        )
        .eq("organization_id", organization.id)
        .eq("source_type", "internal")
        .order("posted_at", { ascending: false }),
      // Counts cannot come from a join: `applications` is owner-only under RLS,
      // so an employer reading it directly gets zero rows and would see "0
      // applications" on every posting — wrong, and silently so. Migration 0029
      // exists for exactly this, and returns counts without applicant identity.
      supabase.rpc("org_application_counts", { p_organization_id: organization.id }),
    ]);

  if (jobsError) {
    throw new Error(`Couldn't load your job postings: ${jobsError.message}`);
  }

  const countByJob = new Map<string, number>(
    (counts ?? []).map((row) => [row.job_posting_id, Number(row.application_count)]),
  );

  /*
   * MINTING HAPPENS HERE, ONCE PER POSTING, and only for an org that has no
   * other way to share. A verified org's jobs are already public; spending a
   * mint on one would consume the employer's daily allowance for nothing.
   *
   * mintUnlistedLink returns the existing stamp without charging when a link
   * already exists, so rendering this page repeatedly costs nothing — the
   * limit counts jobs granted a link, not page views.
   */
  const mintedAt = new Map<string, string>();
  if (!organization.verified) {
    for (const job of jobs ?? []) {
      if (job.status === "removed") continue;
      if (job.unlisted_at) {
        mintedAt.set(job.id, job.unlisted_at);
        continue;
      }
      const result = await mintUnlistedLink({
        jobId: job.id,
        userId,
        status: job.status,
        emailConfirmed,
      });
      if (result.unlistedAt) mintedAt.set(job.id, result.unlistedAt);
    }
  }

  const rows: PostedJob[] = (jobs ?? []).map((job) => ({
    id: job.id,
    title: job.title,
    location: job.location,
    status: job.status,
    removalReason: job.removal_reason,
    postedAt: job.posted_at,
    workType: job.work_type,
    employmentType: job.employment_type,
    unlistedAt: mintedAt.get(job.id) ?? job.unlisted_at ?? null,
    adminReviewRequestedAt: job.admin_review_requested_at,
    adminReviewDecision: job.admin_review_decision,
    applicationCount: countByJob.get(job.id) ?? 0,
  }));

  const openCount = rows.filter((r) => r.status === "open").length;

  // The row this render should just have posted, if the redirect from
  // postJobAction carried its id — not re-fetched, it's already in `rows`
  // from the same query above (freshest first).
  const postedJob = posted ? rows.find((r) => r.id === posted) : undefined;
  // Same shape as postedJob, for claimJobPostingAction's own redirect
  // (`?claimed=<id>`) — the new posting is internal and owned by this org, so
  // it's already in `rows` from the same query above.
  const claimedJob = claimed ? rows.find((r) => r.id === claimed) : undefined;

  /*
   * The stored `organization.verified` bit and a fresh recompute of the same
   * rule can disagree in one direction worth naming: an employer can become
   * eligible (confirms their email, or the domain now matches) without the
   * stored bit ever being told, because that bit is only written inside
   * updateCompanyProfileAction — i.e. when the Company Profile form is next
   * saved, not the moment the underlying facts change. Showing the ordinary
   * per-reason message in that state would say something false ("add your
   * domain") about an account that already has one; showing "Verified" would
   * claim a state the gate (0027) isn't actually honouring yet, since nothing
   * has re-run the service-role `verified` write inside
   * updateCompanyProfileAction (src/lib/employer/actions.ts) for it. So it
   * gets its own honest line instead of either.
   */
  const verificationOutcome = evaluateDomainVerification({
    userEmail,
    emailConfirmed,
    claimedDomain: organization.domain,
  });
  const staleEligible = verificationOutcome.verified && !organization.verified;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <EyebrowLabel>{organization.name}</EyebrowLabel>
          <h1 className="mt-2 font-display text-[30px] leading-[1.15] font-medium text-ink">
            Jobs Posted
          </h1>
          <p className="mt-1.5 font-body text-[14px] text-ink-soft">
            {rows.length === 0
              ? "Nothing posted yet."
              : `${openCount} open · ${rows.length} total`}
          </p>
        </div>
        <Link href="/employer/jobs/new" className={buttonClasses("primary", "md", "no-underline")}>
          Post a job
        </Link>
      </div>

      {/*
        The verification state is stated on the page an employer actually looks
        at, not buried in a settings screen. An unverified company whose jobs
        silently never appear in the feed is the worst version of this gate —
        it looks like the product is broken rather than like there is a step
        left to take.
      */}
      {!organization.verified && (
        <p className="border-[1.5px] border-amber bg-[oklch(96%_0.03_70)] px-4 py-3 text-[13.5px] text-ink">
          {/*
            "{name} isn't verified yet." is asserted verbatim by
            e2e/employer.spec.ts — kept as its own sentence rather than
            reworded into the dynamic message below, so that test keeps
            proving what it always proved (the unverified state is stated,
            not silent) independent of which specific reason follows it.
          */}
          <span className="font-semibold">{organization.name} isn&apos;t verified yet.</span> Your
          jobs are saved and visible to your team, but not in the public job feed.{" "}
          {/*
            SAY WHAT THIS ACCOUNT CAN ACTUALLY DO, which is not the same for
            every unverified org. One that has minted a link has something to
            hand a candidate right now; one that has not — no confirmed email,
            or past its daily limit — does not, and telling it about private
            links would describe a door it cannot open. Gated on the real
            result, not on `!organization.verified`.
          */}
          {mintedAt.size > 0 && (
            <>
              Each job below has a private link you can send directly — it isn&apos;t listed
              anywhere, but it opens for whoever you send it to.{" "}
            </>
          )}
          {employerBannerMessage(verificationOutcome, organization.verified, userEmail)}{" "}
          <Link href="/employer/profile" className="font-semibold text-rust underline underline-offset-2">
            {staleEligible ? "Go to Company Profile" : "Manage verification"}
          </Link>
          .
        </p>
      )}

      {/*
        deleteJobAction's own redirect targets, both back to this page rather
        than a dedicated confirmation screen — the confirmation already
        happened on /employer/jobs/[id]/delete before the action ran. The
        deleted row is gone by the time this renders, so there's nothing left
        to look up the way postedJob/claimedJob do below.
      */}
      {deleted && (
        <p className="border-[1.5px] border-ink bg-[oklch(95%_0.02_60)] px-4 py-3 text-[13.5px] text-ink">
          That posting has been permanently deleted.
        </p>
      )}
      {actionError && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-4 py-3 text-[13.5px] text-rust">
          {actionError}
        </p>
      )}

      {/*
        The post-success surface. There is no dedicated confirmation screen —
        postJobAction redirects straight here with `?posted=<id>` — so this is
        the only place an employer ever sees the link right after posting,
        which is the moment they're most likely to actually go share it.
        Shows nothing if the id in the URL doesn't match a row on this page
        (a stale/copied link, or the job got removed in between).
      */}
      {postedJob && (
        <BorderedCard className="border-ink p-5">
          <p className="font-display text-[16px] font-medium text-ink">
            &quot;{postedJob.title}&quot; is posted.
          </p>
          <div className="mt-3">
            <EmployerJobShareInline
              jobId={postedJob.id}
              jobTitle={postedJob.title}
              origin={origin}
              visibility={getJobShareVisibility({
                status: postedJob.status,
                organizationVerified: organization.verified,
              })}
            />
          </div>
          {/*
            send-132 put a pointer to Edit here, since a banner can't be
            uploaded before this posting exists. send-134 goes further: an
            employer can now pick and crop a banner on the create form itself
            (new-job-banner-picker.tsx), staged client-side until a real jobId
            exists. PostSuccessBannerNote is what actually uploads that staged
            image now that one does, and falls back to the exact same pointer
            text whenever there was nothing staged OR the deferred upload
            failed — see its own header for why those two cases share one
            outcome rather than getting a distinct error state.
          */}
          <PostSuccessBannerNote jobId={postedJob.id} userId={userId} />
        </BorderedCard>
      )}

      {/*
        "Claim your listing" (0128): only shown when there's actually
        something to look at — an employer with zero candidates should never
        see a dead-end link, the same reasoning mintedAt.size > 0 gates the
        private-link copy above.
      */}
      {claimCandidateCount > 0 && (
        <p className="flex flex-wrap items-center justify-between gap-3 border-[1.5px] border-ink bg-[oklch(95%_0.02_60)] px-4 py-3 text-[13.5px] text-ink">
          <span>
            We found {claimCandidateCount} job posting{claimCandidateCount === 1 ? "" : "s"} from other
            sources that might be {organization.name}&apos;s.{" "}
            <Link href="/employer/claim" className="font-semibold text-rust underline underline-offset-2">
              Review and claim them
            </Link>
            .
          </span>
          <form action={dismissClaimReviewAction}>
            <button
              type="submit"
              className="font-body text-[12.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
            >
              Not now
            </button>
          </form>
        </p>
      )}

      {/*
        The claim-success surface — same shape as the post-success one below,
        for claimJobPostingAction's own redirect (`?claimed=<id>`).
      */}
      {claimedJob && (
        <BorderedCard className="border-ink p-5">
          <p className="font-display text-[16px] font-medium text-ink">
            &quot;{claimedJob.title}&quot; is now your own posting.
          </p>
          <p className="mt-2 font-body text-[13.5px] text-ink-soft">
            The original listing has been taken out of the public feed — this one represents the role
            from here on.
          </p>
          <div className="mt-3">
            <EmployerJobShareInline
              jobId={claimedJob.id}
              jobTitle={claimedJob.title}
              origin={origin}
              visibility={getJobShareVisibility({
                status: claimedJob.status,
                organizationVerified: organization.verified,
              })}
            />
          </div>
        </BorderedCard>
      )}

      {countsError && (
        <p className="border-[1.5px] border-rust bg-rust-soft px-4 py-3 text-[13.5px] text-rust">
          Couldn&apos;t load application counts, so the numbers below aren&apos;t reliable right
          now. The postings themselves are fine.
        </p>
      )}

      {rows.length === 0 ? (
        <BorderedCard className="p-8 text-center">
          <p className="font-display text-[20px] font-medium text-ink">
            Post your first role
          </p>
          <p className="mx-auto mt-2 max-w-[46ch] font-body text-[14px] text-ink-soft">
            Seekers are matched against your description automatically — you don&apos;t need to
            tag skills by hand.
          </p>
          <div className="mt-5">
            <Link href="/employer/jobs/new" className={buttonClasses("primary", "md", "no-underline")}>
              Post a job
            </Link>
          </div>
        </BorderedCard>
      ) : (
        <div className="flex flex-col gap-3.5">
          {rows.map((job) => (
            <PostedJobRow key={job.id} job={job} orgVerified={organization.verified} origin={origin} />
          ))}
        </div>
      )}
    </div>
  );
}
