import { BorderedCard } from "@/components/ui";
import type { Tables } from "@/lib/supabase/types";
import { DEGREE_LEVEL_LABEL, FUNDING_TYPE_LABEL, type SaveStatus } from "@/lib/scholarships/types";
import { SaveToggle } from "./save-toggle";
import { SaveStatusSelect } from "./save-status-select";
import { FarahActions } from "./farah-actions";

export interface ScholarshipCardProps {
  scholarship: Tables<"scholarships">;
  save: { id: string; status: SaveStatus } | null;
  creditsBalance: number;
  /** See FarahActions — checkPassCoverage(userId).covered, from the page. */
  passCovered: boolean;
}

/** Days until the deadline, or null when there's no published date. */
export function daysUntil(deadline: string | null): number | null {
  if (!deadline) return null;
  const [y, m, d] = deadline.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Date-only column, so build it in local time — a bare new Date() would
 * shift it a day back west of UTC. Guards the malformed case explicitly
 * rather than letting an unparseable value reach toLocaleDateString and
 * render the string "Invalid Date" at the user.
 */
export function formatDeadline(deadline: string | null): string {
  if (!deadline) return "Not published yet";
  const [y, m, d] = deadline.split("-").map(Number);
  if (!y || !m || !d) return "Not published yet";
  const parsed = new Date(y, m - 1, d);
  if (Number.isNaN(parsed.getTime())) return "Not published yet";
  return parsed.toLocaleDateString();
}

export function ScholarshipCard({ scholarship, save, creditsBalance, passCovered }: ScholarshipCardProps) {
  const left = daysUntil(scholarship.application_deadline);
  const urgent = left !== null && left >= 0 && left <= 14;

  return (
    <BorderedCard className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="font-body text-[12.5px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
            {scholarship.provider}
          </span>
          <h3 className="text-[18px]">{scholarship.program_name}</h3>
          {scholarship.host_institution && (
            <span className="text-[13px] text-ink-soft">{scholarship.host_institution}</span>
          )}
        </div>
        <SaveToggle scholarshipId={scholarship.id} isSaved={!!save} />
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
          <span className="font-semibold">Deadline:</span>{" "}
          <span className={urgent ? "font-semibold text-rust" : undefined}>
            {/*
              A provider with no single deadline (per-partner, per-embassy,
              per-consortium) is verified, not unknown — so show the sourced
              explanation rather than an empty gap or a bare "Not published
              yet", which reads like missing data.
            */}
            {scholarship.application_deadline
              ? formatDeadline(scholarship.application_deadline)
              : (scholarship.deadline_note ?? "Not published yet")}
            {left !== null && left >= 0 && ` · ${left} ${left === 1 ? "day" : "days"} left`}
          </span>
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
