import Link from "next/link";
import { BorderedCard, buttonClasses } from "@/components/ui";
import { setJobStatusAction } from "@/lib/employer/actions";
import { formatRelativeTime } from "@/lib/format-relative-time";

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

export function PostedJobRow({ job, orgVerified }: { job: PostedJob; orgVerified: boolean }) {
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
    <BorderedCard className="flex flex-col gap-4 p-5 min-[760px]:flex-row min-[760px]:items-center min-[760px]:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="font-display text-[19px] font-semibold text-ink">{job.title}</h3>
          {removed && (
            <span className="border border-rust px-2 py-0.5 font-body text-[11px] font-bold tracking-[0.14em] text-rust uppercase">
              Removed
            </span>
          )}
          {job.status === "closed" && (
            <span className="border border-line px-2 py-0.5 font-body text-[11px] font-bold tracking-[0.14em] text-ink-soft uppercase">
              Closed
            </span>
          )}
          {job.status === "open" && !orgVerified && (
            <span
              className="border border-amber px-2 py-0.5 font-body text-[11px] font-bold tracking-[0.14em] text-amber uppercase"
              title="Only your team can see this until the company is verified"
            >
              Not public
            </span>
          )}
        </div>
        {meta.length > 0 && (
          <p className="mt-1 font-body text-[13.5px] text-ink-soft">{meta.join(" · ")}</p>
        )}
        <p className="mt-1 font-body text-[13px] text-ink-soft">
          {/* formatRelativeTime already returns "Posted …" — don't prefix it again. */}
          {formatRelativeTime(job.postedAt)} ·{" "}
          <span className="font-semibold text-ink">
            {job.applicationCount} {job.applicationCount === 1 ? "application" : "applications"}
          </span>
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
      </div>
      )}
    </BorderedCard>
  );
}
