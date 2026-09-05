import Link from "next/link";
import { BorderedCard, IconButton, Button, MatchTierBadge } from "@/components/ui";
import { getCompanyInitials } from "@/lib/jobs/company-initials";
import { postingAgeLine } from "@/lib/jobs/freshness";
import { formatSalary } from "@/lib/jobs/format-salary";
import { FarahJobMenu } from "@/components/jobs/farah-job-menu";
import { ShareJobButton } from "@/components/jobs/share-job-button";
import { ReportJobMenu } from "@/components/jobs/report-job-menu";
import type { MatchExplanation } from "@/lib/matching/score";
import { toggleSaveAction, applyInAppAction, markAppliedExternallyAction } from "@/lib/applications/actions";
import type { CountryState } from "@/lib/jobs/country-events";
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
  // Omit, not the full row: the feed query that supplies this (jobs/page.tsx)
  // fetches `description` pre-truncated via the generated `description_preview`
  // column (migration 0086) and never selects the raw preview column itself —
  // this component never reads it either, so the narrower type costs nothing
  // and matches what the query actually returns.
  job: Omit<Tables<"job_postings">, "description_preview">;
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
  /**
   * People who have actually applied, for an INTERNAL posting.
   *
   * `null` means unknown, and 0 means nobody — they are different facts and
   * the card says so differently. Unknown is the honest answer for an external
   * posting: it is advertised and applied to on someone else's site, so any
   * number we have is the fraction who happened to route through us, and a
   * confidently wrong count is worse than an absent one.
   */
  applicantCount?: number | null;
  /** Stage 12 apply-rate instrumentation — see src/lib/jobs/country-events.ts. */
  countryState: CountryState;
}

export function JobCard({
  job,
  score,
  isSaved,
  applicationStage,
  isSponsored = false,
  explanation,
  origin,
  applicantCount = null,
  countryState,
}: JobCardProps) {
  const metaParts = [
    job.company_name,
    job.location,
    job.work_type ? WORK_TYPE_LABEL[job.work_type] : null,
    job.seniority ? SENIORITY_LABEL[job.seniority] : null,
  ].filter(Boolean);

  const isExternal = job.source_type === "external";
  // Own line, same call as the detail page (jobs/[id]/page.tsx) and the same
  // reason: the one fact on the card most worth scanning for shouldn't be
  // buried mid-string in the middot-joined company/location/seniority line.
  const salary = formatSalary(job);
  const alreadyApplied =
    applicationStage === "applied" ||
    applicationStage === "interviewing" ||
    applicationStage === "offer" ||
    applicationStage === "hired";

  return (
    <BorderedCard data-testid="job-card" className="flex flex-col gap-3.5 p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center bg-ink font-display text-[15px] font-bold text-paper">
          {getCompanyInitials(job.company_name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            {/*
              WRAPS, and the title carries `min-w-0`, because on a phone the
              title and the score do not fit on one line.

              A flex item defaults to `min-width: auto` and refuses to shrink
              below its own min-content width; the badge beside it is
              `flex-shrink-0`. So at 360px the two together pushed the PAGE to
              388px wide — a horizontal scrollbar on every phone.

              It surfaced when match scores first reached three digits: the
              badge reads "100% · Excellent" rather than "72% · Good", and
              those were the characters that stopped fitting. The overflow was
              latent well before that — a long enough title would have done it
              — so this is not a fix about one extra digit.

              Wrapping rather than only shrinking, because shrinking alone
              squeezed "Senior Content Designer" into three lines and broke
              the "sourced externally" pill across two. Dropping the score to
              its own line keeps the title readable and the pill intact.
              Nothing changes above the width where both fit: on desktop the
              row still reads title-left, score-right.
            */}
            <h3 className="min-w-0 text-[17px]">
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
          {salary && <div className="mt-1 text-[13.5px] font-semibold text-ink">{salary}</div>}
        </div>
      </div>

      <p data-testid="job-card-description" className="line-clamp-3 text-[14px] leading-relaxed text-ink-soft">
        {job.description.slice(0, 280)}
      </p>

      <div className="flex items-center justify-between border-t border-line pt-3.5">
        <div className="flex flex-col gap-[3px]">
          {/*
            One line, not two: e2e/feed-chrome.spec.ts pins every card's age
            and applicant-count facts to the SAME "Posted … ago · …" string
            (checked before Stage 5a existed), so postingAgeLine's own
            "· re-verified M" clause (external only, src/lib/jobs/freshness.ts)
            joins the applicant clause on this one span rather than splitting
            into a second line. Internal cards never get "re-verified" from
            postingAgeLine, so their line reads exactly as it did before:
            "Posted N days ago · N applicants".
          */}
          <span className="text-[12.5px] text-ink-soft">
            {postingAgeLine(job)} ·{" "}
            {/*
              Shown at zero rather than hidden. "0 applicants" is a real and
              useful thing for a seeker to know — an untouched posting is a
              better bet than a crowded one — and hiding the line at zero would
              make its absence ambiguous with the unknown case below.
            */}
            {applicantCount === null
              ? "Applicant count unavailable"
              : `${applicantCount} ${applicantCount === 1 ? "applicant" : "applicants"}`}
          </span>
        </div>
        {/*
          WRAPS, because at phone widths it did not fit and nothing gave.
          This row is 350px of Save / Share / Ask Farah / Report / Apply, and
          it sat in a `justify-between` footer as a non-shrinking block: the
          document measured 456px wide against a 390px viewport, and against
          360 and 412 too — the same 456 every time, because the row's width is
          intrinsic and does not respond to the screen at all.

          `flex-wrap` is what lets it respond. A wrapping flex container's
          min-content width is its widest CHILD rather than the sum of them, so
          the row can shrink and spill onto another line instead of pushing the
          page sideways. `justify-end` keeps the buttons against the right edge
          once they wrap, where they were before.

          ONLY BELOW 760, and that boundary was measured rather than assumed.
          Wrapping unconditionally also changed widths that were never broken:
          the row went from 81px to 124px tall at 768 and 61px to 90px at 1024,
          because `flex-wrap` lets a flex item shrink past its max-content
          width and `justify-between` then does exactly that. 1280 was
          identical either way. So the wrap is gated to the same 760px the
          shell uses, and 768 and up render as they did before.

          The card is roomier below 760 than just above it, which is not
          intuitive: the Farah panel stacks there, so the content column is
          711px at 759 and 400px at 760. The overflow this fixes is at 360-412,
          where the column is 312-364 and the row's 350px does not fit.
        */}
        <div
          data-testid="job-card-actions"
          className="relative flex flex-wrap items-center justify-end gap-2.5 min-[760px]:flex-nowrap"
        >
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
            Report sits before Ask Farah, and as an icon rather than a word:
            it is the least-used action on the card, and putting it beside
            Apply — or spelling it out mid-row between Save and Share — would
            give a takedown request more weight than applying.

            Grouping it with the other two circular buttons is also what keeps
            the row honest about hierarchy: glyphs are the quiet actions, text
            is the loud one, and Apply is the only text button left.
          */}
          <ReportJobMenu jobId={job.id} jobTitle={job.title} />
          <FarahJobMenu jobId={job.id} explanation={explanation} />

          {alreadyApplied ? (
            <span className="inline-flex min-h-10 items-center px-4 text-[13.5px] font-semibold text-green">
              Applied
            </span>
          ) : isExternal ? (
            <>
              <form action={markAppliedExternallyAction.bind(null, job.id, countryState)}>
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
            <form action={applyInAppAction.bind(null, job.id, countryState)}>
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
