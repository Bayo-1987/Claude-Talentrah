import Link from "next/link";
import { Card, Button, buttonClasses } from "@/components/ui";
import { requestJobReviewAction, setJobStatusAction } from "@/lib/employer/actions";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { EmployerJobShareButton } from "@/components/employer/job-share-button";
import { getJobShareVisibility } from "@/lib/employer/job-visibility";

export interface PostedJob {
  id: string;
  title: string;
  location: string | null;
  status: "open" | "closed" | "removed";
  /** Set only when status is "removed". Operator-written; shown to the org. */
  removalReason: string | null;
  postedAt: string;
  applicationCount: number;
  workType: string | null;
  employmentType: string | null;
  /** Non-null once a private link has been minted for this posting (0107). */
  unlistedAt: string | null;
  /** The employer's own "Submit for review" click (Path 3, 0118/0119). */
  adminReviewRequestedAt: string | null;
  /** 'approved' | 'rejected' | null — an admin's Path 3 decision, if any. */
  adminReviewDecision: string | null;
}

const LABELS: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};

export function PostedJobRow({
  job,
  orgVerified,
  origin,
}: {
  job: PostedJob;
  orgVerified: boolean;
  /** Resolved server-side — see EmployerJobShareButton's own comment. */
  origin: string;
}) {
  /*
   * A removed posting still appears here, on purpose: 0056 deliberately leaves
   * `is_org_member` out of the new `status <> 'removed'` conditions so an
   * employer is never left wondering where their job went. That visibility is
   * only worth having if the page explains it, which is what the badge and the
   * reason below are for.
   *
   * Edit and the open/close toggle are hidden rather than disabled, because
   * the database refuses both — the UPDATE policy's USING clause excludes
   * removed rows. A button that always errors is worse than no button.
   */
  const removed = job.status === "removed";

  const meta = [
    job.location,
    job.workType ? LABELS[job.workType] : null,
    job.employmentType ? LABELS[job.employmentType] : null,
  ].filter(Boolean);

  return (
    <Card className="flex flex-col gap-4 p-5 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="font-display text-[19px] font-semibold text-ink">{job.title}</h3>
          {removed && (
            <span className="border border-coral px-2 py-0.5 font-body text-[11px] font-bold tracking-[0.14em] text-coral uppercase">
              Removed
            </span>
          )}
          {job.status === "closed" && (
            <span className="border border-line px-2 py-0.5 font-body text-[11px] font-bold tracking-[0.14em] text-ink-soft uppercase">
              Closed
            </span>
          )}
          {/*
            "Not public" was accurate when there was nothing to do about it. Now
            there is: an unverified org with a minted link has something it can
            actually hand a candidate, and a badge that still reads as a wall
            would be describing the old behaviour.
          */}
          {job.status === "open" && !orgVerified && (
            job.unlistedAt ? (
              <span
                className="border border-ink-soft px-2 py-0.5 font-body text-[11px] font-bold tracking-[0.14em] text-ink-soft uppercase"
                title="Not on the job board — but anyone with the link can open it"
              >
                Private link only
              </span>
            ) : (
              <span
                className="border border-amber px-2 py-0.5 font-body text-[11px] font-bold tracking-[0.14em] text-amber uppercase"
                title="Only your team can see this until the company is verified"
              >
                Not public
              </span>
            )
          )}
          {/*
            Path 3 (0118/0119): reflects the admin's decision honestly rather
            than silently reverting to the "Not public" badge above once one
            exists — an employer who was told "approved" and later sees
            nothing at all would reasonably assume something broke.
          */}
          {job.status === "open" && !orgVerified && job.adminReviewDecision === "approved" && (
            <span
              className="border border-green px-2 py-0.5 font-body text-[11px] font-bold tracking-[0.14em] text-green uppercase"
              title="An admin approved this posting for the public feed — this does not verify your company"
            >
              Approved for the feed
            </span>
          )}
          {job.status === "open" &&
            !orgVerified &&
            job.adminReviewDecision === "rejected" && (
              <span
                className="border border-coral px-2 py-0.5 font-body text-[11px] font-bold tracking-[0.14em] text-coral uppercase"
                title="An admin reviewed this posting and did not approve it for the public feed"
              >
                Review: not approved
              </span>
            )}
          {job.status === "open" &&
            !orgVerified &&
            job.adminReviewRequestedAt &&
            !job.adminReviewDecision && (
              <span
                className="border border-ink-soft px-2 py-0.5 font-body text-[11px] font-bold tracking-[0.14em] text-ink-soft uppercase"
                title="Submitted for an admin to individually review"
              >
                Pending review
              </span>
            )}
        </div>
        {meta.length > 0 && (
          <p className="mt-1 font-body text-[13.5px] text-ink-soft">{meta.join(" · ")}</p>
        )}
        <p className="mt-1 font-body text-[13px] text-ink-soft">
          {/* formatRelativeTime already returns "Posted …" — don't prefix it again. */}
          {formatRelativeTime(job.postedAt)} ·{" "}
          {/*
            The count itself stays the aggregate-only org_application_counts
            read (0029) — this just makes it a real link into the structured
            list (0125) rather than a static number, when there's actually
            someone to see. Zero applicants links to nothing: an empty
            applicants page for every unapplied-to posting is not worth the
            click, and the count already says so.
          */}
          {job.applicationCount > 0 ? (
            <Link
              href={`/employer/jobs/${job.id}/applicants`}
              className="font-semibold text-ink underline underline-offset-2 hover:text-coral"
            >
              {job.applicationCount} {job.applicationCount === 1 ? "application" : "applications"}
            </Link>
          ) : (
            <span className="font-semibold text-ink">
              {job.applicationCount} applications
            </span>
          )}
        </p>
      </div>

      {removed ? (
        <p className="max-w-[280px] flex-shrink-0 font-display text-[13.5px] italic text-ink-soft">
          Removed by Talentrah
          {job.removalReason ? `: ${job.removalReason}` : "."}{" "}
          Reply to your verification email if you think this is wrong.
        </p>
      ) : (
      <div className="flex flex-shrink-0 items-center gap-3">
        <Link href={`/employer/jobs/${job.id}/edit`} className={buttonClasses("secondary", "sm", "no-underline")}>
          Edit
        </Link>
        {/* Server action bound per row — no client JS needed to close or reopen. */}
        <form action={setJobStatusAction.bind(null, job.id, job.status === "open" ? "closed" : "open")}>
          <button type="submit" className={buttonClasses("text", "sm")}>
            {job.status === "open" ? "Close" : "Reopen"}
          </button>
        </form>
        {/*
          CLOSED ONLY — see deleteJobAction/deleteJobPosting's own headers for
          why. Hidden rather than disabled for an open posting, the same
          principle this file's own header comment states for Edit/Close on a
          removed row: a button that would just be refused isn't worth
          showing. A dedicated confirmation page, not a bare button here —
          this is the one row action irreversible enough to deserve its own
          screen rather than a single click.
        */}
        {job.status === "closed" && (
          <Link
            href={`/employer/jobs/${job.id}/delete`}
            className={buttonClasses("text", "sm", "no-underline")}
          >
            Delete
          </Link>
        )}
        <EmployerJobShareButton
          jobId={job.id}
          jobTitle={job.title}
          origin={origin}
          visibility={getJobShareVisibility({
            status: job.status,
            organizationVerified: orgVerified,
            unlistedAt: job.unlistedAt,
          })}
        />
        {/*
          Path 3 (0118/0119). Only offered once: the button disappears the
          moment a request or a decision exists — the badges above are what
          reflect that state honestly, not a second copy of the button
          silently reappearing.

          CAC verification (0113/0114/0120) already covered by `orgVerified`
          alone: `decideCacVerificationAction`'s approve branch
          (src/lib/admin/moderation/actions.ts) sets the SAME
          `organizations.verified` column domain verification does — there is
          no separate "CAC-verified but not verified" state to check for.
        */}
        {job.status === "open" &&
          !orgVerified &&
          !job.adminReviewRequestedAt &&
          !job.adminReviewDecision && (
            <form action={requestJobReviewAction.bind(null, job.id)}>
              <Button type="submit" size="sm" variant="secondary">
                Submit for review
              </Button>
            </form>
          )}
      </div>
      )}
    </Card>
  );
}
