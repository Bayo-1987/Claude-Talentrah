import Link from "next/link";
import { FilterChip } from "@/components/ui";
import { MATCH_TIER_LABEL, MATCH_TIER_TEXT_CLASS, type MatchTier } from "@/lib/match-tier";
import type { ScreeningFilter } from "@/lib/employer/applicant-filters";
import { cn } from "@/lib/cn";

const TIERS: MatchTier[] = ["excellent", "good", "fair"];

function buildHref(
  jobId: string,
  tiers: MatchTier[],
  hideUnscored: boolean,
  screening: ScreeningFilter,
): string {
  const params = new URLSearchParams();
  if (tiers.length) params.set("tier", tiers.join(","));
  if (hideUnscored) params.set("unscored", "hide");
  if (screening) params.set("screening", screening);
  const qs = params.toString();
  return qs ? `/employer/jobs/${jobId}/applicants?${qs}` : `/employer/jobs/${jobId}/applicants`;
}

function toggled(tiers: MatchTier[], tier: MatchTier): MatchTier[] {
  return tiers.includes(tier) ? tiers.filter((t) => t !== tier) : [...tiers, tier];
}

/**
 * Toggling an already-active screening value clears it back to unset — the
 * two chips act as one mutually exclusive control, not two independent
 * booleans (a row can't be both "passed" and "failed" screening at once).
 */
function toggledScreening(current: ScreeningFilter, value: "passed" | "failed"): ScreeningFilter {
  return current === value ? undefined : value;
}

const SCREENING_LABEL: Record<"passed" | "failed", string> = {
  passed: "Passed screening",
  failed: "Didn't pass screening",
};

/** ≥40×40 hit target, same rule every other interactive element on the app follows. */
const TOGGLE_CLASS =
  "inline-flex min-h-10 min-w-10 items-center justify-center whitespace-nowrap border border-line px-3 font-body text-[12.5px] font-bold uppercase tracking-[0.08em] no-underline";

/**
 * send-326 — a page-level filter over what `employer_job_applicants` (0125/
 * 0154) already returns, not a new query. Server-rendered links only, same
 * "GET-driven, works with JS off" convention as the jobs feed's own
 * FilterBar: tier and "unscored" are both plain hrefs, so the filter state
 * lives in the URL and is shareable/bookmarkable, not client-only state.
 */
export function ApplicantFilterBar({
  jobId,
  tiers,
  hideUnscored,
  screening,
  hasScreeningQuestions,
}: {
  jobId: string;
  tiers: MatchTier[];
  hideUnscored: boolean;
  screening: ScreeningFilter;
  /**
   * Only render the screening chips at all when this posting actually has
   * screening questions — otherwise the control would just be a no-op, the
   * same reason the tier chips don't need a matching guard (every posting
   * has a match score, but not every posting has screening questions).
   */
  hasScreeningQuestions: boolean;
}) {
  const anyApplied = tiers.length > 0 || hideUnscored || screening !== undefined;

  return (
    <div className="flex flex-col gap-3 border-y border-line py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-body text-[12.5px] font-semibold text-ink-soft">Match:</span>
        {TIERS.map((tier) => {
          const active = tiers.includes(tier);
          return (
            <Link
              key={tier}
              href={buildHref(jobId, toggled(tiers, tier), hideUnscored, screening)}
              aria-pressed={active}
              className={cn(
                TOGGLE_CLASS,
                active ? cn("border-ink", MATCH_TIER_TEXT_CLASS[tier]) : "text-ink-soft hover:text-ink",
              )}
            >
              {MATCH_TIER_LABEL[tier]}
            </Link>
          );
        })}
        <Link
          href={buildHref(jobId, tiers, !hideUnscored, screening)}
          aria-pressed={hideUnscored}
          className={cn(TOGGLE_CLASS, hideUnscored ? "border-ink text-ink" : "text-ink-soft hover:text-ink")}
        >
          {hideUnscored ? "Unscored hidden" : "Unscored shown"}
        </Link>
      </div>

      {hasScreeningQuestions && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-body text-[12.5px] font-semibold text-ink-soft">Screening:</span>
          {(["passed", "failed"] as const).map((value) => {
            const active = screening === value;
            return (
              <Link
                key={value}
                href={buildHref(jobId, tiers, hideUnscored, toggledScreening(screening, value))}
                aria-pressed={active}
                className={cn(TOGGLE_CLASS, active ? "border-ink text-ink" : "text-ink-soft hover:text-ink")}
              >
                {SCREENING_LABEL[value]}
              </Link>
            );
          })}
        </div>
      )}

      {anyApplied && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="font-semibold text-ink-soft">Showing:</span>
          {tiers.map((tier) => (
            <FilterChip
              key={tier}
              label={MATCH_TIER_LABEL[tier]}
              removeHref={buildHref(jobId, toggled(tiers, tier), hideUnscored, screening)}
            />
          ))}
          {hideUnscored && (
            <FilterChip
              label="Unscored hidden"
              removeHref={buildHref(jobId, tiers, false, screening)}
            />
          )}
          {screening && (
            <FilterChip
              label={SCREENING_LABEL[screening]}
              removeHref={buildHref(jobId, tiers, hideUnscored, undefined)}
            />
          )}
        </div>
      )}
    </div>
  );
}
