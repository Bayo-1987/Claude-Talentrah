import Link from "next/link";
import { BorderedCard, buttonClasses } from "@/components/ui";
import { setJobStatusAction } from "@/lib/employer/actions";
import { formatRelativeTime } from "@/lib/format-relative-time";

export interface PostedJob {
  id: string;
  title: string;
  location: string | null;
  status: "open" | "closed";
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
    </BorderedCard>
  );
}
