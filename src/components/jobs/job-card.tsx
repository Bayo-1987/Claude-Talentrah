import Link from "next/link";
import { BorderedCard, IconButton, Button, MatchTierBadge } from "@/components/ui";
import { getCompanyInitials } from "@/lib/jobs/company-initials";
import { formatRelativeTime } from "@/lib/format-relative-time";
import { freshnessNote } from "@/lib/jobs/freshness-note";
import { FarahJobMenu } from "@/components/jobs/farah-job-menu";
import { ShareJobButton } from "@/components/jobs/share-job-button";
import { ReportJobMenu } from "@/components/jobs/report-job-menu";
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
  /**
   * Absolute origin for share links, resolved once by the page.
   *
   * Per-card would mean one `headers()` read per card; the value is identical
   * for every card in a render.
   */
  origin: string;
}

export function JobCard({
  job,
  score,
  isSaved,
  applicationStage,
  isSponsored = false,
  explanation,
  origin,
}: JobCardProps) {
  const metaParts = [
    job.company_name,
    job.location,
    job.work_type ? WORK_TYPE_LABEL[job.work_type] : null,
    job.seniority ? SENIORITY_LABEL[job.seniority] : null,
  ].filter(Boolean);

  const isExternal = job.source_type === "external";
  const freshness = freshnessNote(job);
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
              {/*
                Only the title text is the link, not the whole heading — the
                badges beside it describe the posting, they are not part of its
                name, and swallowing them into the anchor would put "sourced
                externally" inside the link text every screen reader announces.
              */}
              <Link
                href={`/jobs/${job.id}`}
                className="text-ink no-underline hover:text-rust hover:underline"
              >
                {job.title}
              </Link>
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
        <div className="flex flex-col gap-[3px]">
          <span className="text-[12.5px] text-ink-soft">
            {formatRelativeTime(job.posted_at)}
          </span>
          {/*
            Italic Newsreader is the design system's quiet-aside voice, and
            --ink-soft keeps it there. The reference mock set this line in
            --rust; it is deliberately not followed. Rust is one of the three
            match-tier colours, and a coloured line on the card is how a fourth
            tier gets invented by accident. Finding 04's own guidance was "one
            flag, plain text, no icon" — a colour is not plain text.
          */}
          {freshness && (
            <span className="font-display text-[12px] italic text-ink-soft">{freshness}</span>
          )}
        </div>
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
          <ShareJobButton
            jobId={job.id}
            jobTitle={job.title}
            companyName={job.company_name}
            origin={origin}
          />
          {/*
            Report sits before Ask Farah and is styled quieter than it:
            --ink-soft, no underline, no chevron. It is the least-used action
            on the card and putting it beside Apply would give a takedown
            request the same weight as applying.
          */}
          <ReportJobMenu jobId={job.id} jobTitle={job.title} />
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
