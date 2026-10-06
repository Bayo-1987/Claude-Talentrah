import Link from "next/link";
import { BorderedCard } from "@/components/ui";
import type { ScholarshipRow } from "@/lib/scholarships/columns";
import { DEGREE_LEVEL_LABEL, FUNDING_TYPE_LABEL, type SaveStatus } from "@/lib/scholarships/types";
import { SaveToggle } from "./save-toggle";
import { SaveStatusSelect } from "./save-status-select";
import { FarahActions } from "./farah-actions";
import { ScholarshipShareButton } from "./scholarship-share-button";
import { formatCalendarDate } from "@/lib/format/datetime";
import { scholarshipDeadlineDisplay } from "@/lib/scholarships/close-instant";
import { DeadlineLine } from "@/components/scholarships/deadline-line";
import { deadlineNoteOrFallback } from "@/lib/scholarships/public-deadline-note";

export interface ScholarshipCardProps {
  scholarship: ScholarshipRow;
  save: { id: string; status: SaveStatus } | null;
  creditsBalance: number;
  /** See FarahActions — checkPassCoverage(userId).covered, from the page. */
  passCovered: boolean;
  /** Absolute origin for the share link, resolved once by the page — see ShareJobButton's own comment on why per-card would be wasteful. */
  origin: string;
  /** The signed-in viewer's own referral code — always present on this authenticated list, but optional here since the component makes no assumption a caller must supply one. */
  referralCode?: string | null;
}

/**
 * A date-only column, in the app's one calendar-date format ("2 Oct 2026", src/lib/format/datetime.ts): never shifted by a
 * time zone, never the runtime's locale ("10/2/2026" read as 10 February). A malformed value says "Not published yet"
 * rather than "Invalid Date".
 */
export function formatDeadline(deadline: string | null): string {
  if (!deadline) return "Not published yet";
  return formatCalendarDate(deadline) || "Not published yet";
}

export function ScholarshipCard({
  scholarship,
  save,
  creditsBalance,
  passCovered,
  origin,
  referralCode,
}: ScholarshipCardProps) {
  // One countdown for every surface (close-instant.ts, send-511): whole days to the closing instant for a row with a zone; the stated date, in four
  // states, for a row without one. A closed row is not listed here, so it carries no phrase.
  const deadline = scholarshipDeadlineDisplay(scholarship, new Date(), { detailed: false, showClosed: false });
  const urgent = deadline?.urgent ?? false;

  return (
    <BorderedCard className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="font-body text-[12.5px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
            {scholarship.provider}
          </span>
          {/*
            The ONLY link on this card to Talentrah's own scholarship page —
            everything else here (see "View the official listing" below)
            deliberately points off-site. Before this, a reader browsing the
            list had no way to reach /scholarships/[id] at all: a real, public,
            sitemap-listed page that every card routed traffic away from.
            Only the title text is the link, matching job-card.tsx's own
            rule — the metadata beside a title is not part of its name.
          */}
          <h3 className="text-[18px]">
            <Link
              href={`/scholarships/${scholarship.id}`}
              className="text-ink no-underline hover:text-rust hover:underline"
            >
              {scholarship.program_name}
            </Link>
          </h3>
          {scholarship.host_institution && (
            <span className="text-[13px] text-ink-soft">{scholarship.host_institution}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <ScholarshipShareButton
            scholarshipId={scholarship.id}
            programName={scholarship.program_name}
            provider={scholarship.provider}
            origin={origin}
            referralCode={referralCode}
          />
          <SaveToggle scholarshipId={scholarship.id} isSaved={!!save} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {scholarship.degree_levels.map((level) => (
          <span
            key={level}
            className="inline-flex min-h-7 items-center border border-line px-2 text-[12px] font-semibold text-ink-soft"
          >
            {DEGREE_LEVEL_LABEL[level]}
          </span>
        ))}
        <span className="inline-flex min-h-7 items-center border border-line px-2 text-[12px] font-semibold text-ink-soft">
          {FUNDING_TYPE_LABEL[scholarship.funding_type]}
        </span>
        {scholarship.funding_covers.length > 0 && (
          <span className="text-[12.5px] italic text-ink-soft">
            covers {scholarship.funding_covers.join(", ")}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13.5px] text-ink-soft">
        <span>
          {/*
              A provider with no single deadline (per-partner, per-embassy,
              per-consortium) is verified, not unknown — so show the sourced
              explanation rather than an empty gap or a bare "Not published
              yet", which reads like missing data.
            */}
          <DeadlineLine
            text={
              scholarship.application_deadline
                ? (deadline?.text ?? formatDeadline(scholarship.application_deadline))
                : deadlineNoteOrFallback(scholarship)
            }
            urgent={urgent}
            labelled={deadline?.labelled ?? true}
          />
        </span>
        {scholarship.field_tags.length > 0 && (
          <span className="text-[13px]">{scholarship.field_tags.slice(0, 3).join(" · ")}</span>
        )}
      </div>

      {scholarship.eligibility_nationalities.length > 0 && (
        <p className="text-[13px] text-ink-soft">
          <span className="font-semibold">Open to:</span>{" "}
          {scholarship.eligibility_nationalities.join(", ")}
        </p>
      )}

      {/*
        §6.15 makes this non-negotiable, not a styling preference: Talentrah
        is a discovery layer, not the authority on any of the terms above, so
        the route to the primary source has to be visible on the card itself
        rather than buried behind a detail view.
      */}
      <a
        href={scholarship.official_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-10 w-fit items-center gap-1.5 font-body text-[13.5px] font-semibold text-rust underline underline-offset-2 hover:text-rust-hover"
      >
        View the official listing
        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M7 4h9v9M16 4L4 16"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </a>
      <p className="text-[12px] italic text-ink-soft">
        {scholarship.source_name
          ? `Listed from ${scholarship.source_name}. `
          : ""}
        Always confirm current terms and deadlines on the official page.
      </p>

      {save && (
        <div className="flex items-center gap-3 border-t border-line pt-3">
          <span className="text-[12.5px] font-semibold text-ink-soft">Your progress:</span>
          <SaveStatusSelect saveId={save.id} status={save.status} />
        </div>
      )}

      <FarahActions scholarshipId={scholarship.id} creditsBalance={creditsBalance} passCovered={passCovered} />
    </BorderedCard>
  );
}
