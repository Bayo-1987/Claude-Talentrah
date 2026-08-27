import { BorderedCard, IconButton, Button, MatchTierBadge } from "@/components/ui";
import { getCompanyInitials } from "@/lib/jobs/company-initials";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { FarahJobMenu } from "@/components/jobs/farah-job-menu";
import type { MatchExplanation } from "@/lib/matching/score";
import { toggleSaveAction, applyInAppAction, markAppliedExternallyAction } from "@/lib/applications/actions";
import type { Tables } from "@/lib/supabase/types";

const WORK_TYPE_LABEL: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
};

const SENIORITY_LABEL: Record<string, string> = {
  entry: "Entry",
  mid: "Mid-level",
  senior: "Senior",
  lead: "Lead",
  executive: "Executive",
};

export interface JobCardProps {
  job: Tables<"job_postings">;
  score: number;
  isSaved: boolean;
  applicationStage: Tables<"applications">["stage"] | null;
  /** Paid placement. Labelled on the card; never affects the score shown. */
  isSponsored?: boolean;
  /** Drives the menu's free Vet answers. Already computed for `score`. */
  explanation: MatchExplanation;
}

export function JobCard({ job, score, isSaved, applicationStage, isSponsored = false, explanation }: JobCardProps) {
  const metaParts = [
    job.company_name,
    job.location,
    job.work_type ? WORK_TYPE_LABEL[job.work_type] : null,
    job.seniority ? SENIORITY_LABEL[job.seniority] : null,
  ].filter(Boolean);

  const isExternal = job.source_type === "external";
  const alreadyApplied =
    applicationStage === "applied" ||
    applicationStage === "interviewing" ||
    applicationStage === "offer" ||
    applicationStage === "hired";

  return (
    <BorderedCard className="flex flex-col gap-3.5 p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center bg-ink font-display text-[15px] font-bold text-paper">
          {getCompanyInitials(job.company_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-[17px]">
              {job.title}
              {isExternal && (
                <span className="ml-2 border border-line px-2 py-0.5 font-display text-[10.5px] font-bold italic text-ink-soft">
                  sourced externally
                </span>
              )}
              {/*
                Solid --ink, like the company badge, and for the same reason:
                the three match tiers own green/rust/amber, and a fourth
                coloured pill here would read as a fourth tier. It is also
                visually unlike the italic serif "sourced externally", because
                the two say different things — one is where the job came from,
                the other is that someone paid for its position.

                The word is "Sponsored" and stays "Sponsored" everywhere.
              */}
              {isSponsored && (
                <span className="ml-2 bg-ink px-2 py-0.5 align-[0.15em] font-body text-[10px] font-bold tracking-[0.14em] text-paper uppercase">
                  Sponsored
                </span>
              )}
            </h3>
            <MatchTierBadge score={score} className="flex-shrink-0" />
          </div>
          <div className="mt-0.5 text-[13px] text-ink-soft">{metaParts.join(" · ")}</div>
        </div>
      </div>

      <p className="line-clamp-3 text-[14px] leading-relaxed text-ink-soft">
        {job.description.slice(0, 280)}
      </p>

      <div className="flex items-center justify-between border-t border-line pt-3.5">
        <span className="text-[12.5px] text-ink-soft">
          {formatRelativeTime(job.posted_at)}
        </span>
        <div className="relative flex items-center gap-2.5">
          <form action={toggleSaveAction.bind(null, job.id)}>
            <IconButton aria-label={isSaved ? "Unsave" : "Save"} type="submit">
              <svg width="16" height="16" viewBox="0 0 20 20" fill={isSaved ? "currentColor" : "none"}>
                <path
                  d="M10 16.5 C6 13.5 2.5 10.8 2.5 7.3 A3.8 3.8 0 0 1 10 5.3 A3.8 3.8 0 0 1 17.5 7.3 C17.5 10.8 14 13.5 10 16.5Z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
            </IconButton>
          </form>
          <IconButton
            aria-label="Share"
            type="button"
            title="Coming soon"
            className="cursor-not-allowed opacity-60"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
              <circle cx="15" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="5" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="15" cy="15" r="2.2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M7 8.8 L13 6.2 M7 11.2 L13 13.8" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </IconButton>
          <FarahJobMenu jobId={job.id} explanation={explanation} />

          {alreadyApplied ? (
            <span className="inline-flex min-h-10 items-center px-4 text-[13.5px] font-semibold text-green">
              Applied
            </span>
          ) : isExternal ? (
            <>
              <form action={markAppliedExternallyAction.bind(null, job.id)}>
                <button
                  type="submit"
                  className="text-[13px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
                >
                  Mark as applied
                </button>
              </form>
              <a
                href={job.external_url ?? "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-10 items-center justify-center border-none bg-ink px-[18px] py-[10px] font-body text-[13.5px] font-semibold text-paper no-underline transition-colors hover:bg-rust"
              >
                Apply on company site
              </a>
            </>
          ) : (
            <form action={applyInAppAction.bind(null, job.id)}>
              <Button size="sm" type="submit">
                Apply
              </Button>
            </form>
          )}
        </div>
      </div>
    </BorderedCard>
  );
}
