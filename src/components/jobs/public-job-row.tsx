import Link from "next/link";
import { BorderedCard } from "@/components/ui";
import { getCompanyInitials } from "@/lib/jobs/company-initials";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { formatSalary } from "@/lib/jobs/format-salary";
import type { Tables } from "@/lib/supabase/types";

const WORK_TYPE_LABEL: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
};

const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
};

/**
 * A job on an SEO landing page — read-only, no Save/Apply/Ask-Farah.
 *
 * Deliberately not JobCard: that component is built for the authenticated,
 * match-scored feed (a score badge scored against a resume, in-app apply
 * actions) and none of that exists for a signed-out visitor arriving from
 * search. Same philosophy the /jobs/[id] detail page already applies —
 * "signed out: read everything, act on nothing" — the act-on-it path is the
 * detail page's own signup CTA, not a widget repeated on every landing page.
 */
export function PublicJobRow({ job }: { job: Tables<"job_postings"> }) {
  const meta = [
    job.company_name,
    job.location,
    job.work_type ? WORK_TYPE_LABEL[job.work_type] : null,
    job.employment_type ? EMPLOYMENT_LABEL[job.employment_type] : null,
  ].filter(Boolean);
  const salary = formatSalary(job);

  return (
    <BorderedCard className="flex flex-col gap-2 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center bg-ink font-display text-[13px] font-bold text-paper">
          {getCompanyInitials(job.company_name)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px]">
            <Link href={`/jobs/${job.id}`} className="text-ink no-underline hover:text-rust hover:underline">
              {job.title}
            </Link>
          </h3>
          <div className="mt-0.5 text-[13px] text-ink-soft">{meta.join(" · ")}</div>
          {salary && <div className="mt-1 text-[13px] font-semibold text-ink">{salary}</div>}
        </div>
      </div>
      <p className="line-clamp-2 text-[13.5px] leading-relaxed text-ink-soft">
        {job.description.slice(0, 220)}
      </p>
      <span className="text-[12px] text-ink-soft">{formatRelativeTime(job.posted_at)}</span>
    </BorderedCard>
  );
}
