import Link from "next/link";
import { FilterChip } from "@/components/ui";
import type { SkillFacetEntry } from "@/lib/jobs/skill-facet";

const WORK_TYPES = ["remote", "hybrid", "onsite"] as const;
const SENIORITIES = ["entry", "mid", "senior", "lead", "executive"] as const;

const LABEL: Record<string, string> = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "Onsite",
  entry: "Entry",
  mid: "Mid-level",
  senior: "Senior",
  lead: "Lead",
  executive: "Executive",
};

function buildHref(
  base: Record<string, string | undefined>,
  changes: Record<string, string | undefined>,
) {
  const params = new URLSearchParams();
  const merged = { ...base, ...changes };
  for (const [key, value] of Object.entries(merged)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/jobs?${qs}` : "/jobs";
}

export interface FilterBarProps {
  tab: string;
  workType?: string;
  seniority?: string;
  /** Applied skill filter, lowercase — matches `structured_jd.skills`. */
  skill?: string;
  /**
   * Skills present in the postings currently on the board, with counts.
   * Derived from ingested text, never a maintained list — see skill-facet.ts.
   */
  skillFacet?: SkillFacetEntry[];
}

/** Server-rendered, no client JS: every chip/toggle is a plain link that updates the URL. */
export function FilterBar({ tab, workType, seniority, skill, skillFacet = [] }: FilterBarProps) {
  const base = { tab, workType, seniority, skill };

  return (
    <div className="flex flex-col gap-3 border-y border-line py-3">
      <div className="flex flex-wrap items-center gap-2">
        {workType && (
          <FilterChip
            label={LABEL[workType]}
          />
        )}
        {seniority && <FilterChip label={LABEL[seniority]} />}
        {skill && <FilterChip label={skill} />}
        {(workType || seniority || skill) && (
          <Link
            href={buildHref(base, { workType: undefined, seniority: undefined, skill: undefined })}
            className="text-[12.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
          >
            Clear filters
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-[12.5px]">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-ink-soft">Work type:</span>
          {WORK_TYPES.map((wt) => (
            <Link
              key={wt}
              href={buildHref(base, { workType: workType === wt ? undefined : wt })}
              className={
                workType === wt
                  ? "font-semibold text-rust underline underline-offset-2"
                  : "text-ink-soft underline underline-offset-2 hover:text-rust"
              }
            >
              {LABEL[wt]}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-ink-soft">Seniority:</span>
          {SENIORITIES.map((s) => (
            <Link
              key={s}
              href={buildHref(base, { seniority: seniority === s ? undefined : s })}
              className={
                seniority === s
                  ? "font-semibold text-rust underline underline-offset-2"
                  : "text-ink-soft underline underline-offset-2 hover:text-rust"
              }
            >
              {LABEL[s]}
            </Link>
          ))}
        </div>
      </div>
      {/*
        Skills parsed out of the postings themselves, not a category list
        anyone maintains — a value appears here because a job mentioned it.
        Counts are shown because they are the honest part: the most common
        values in this data are "communication" and "operations", matching
        roughly half the board, and a chip that narrows almost nothing should
        say so on its face rather than look like a precise filter.
      */}
      {skillFacet.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px]">
          <span className="font-semibold text-ink-soft">Mentioned in the job text:</span>
          {skillFacet.map((entry) => (
            <Link
              key={entry.skill}
              href={buildHref(base, { skill: skill === entry.skill ? undefined : entry.skill })}
              className={
                skill === entry.skill
                  ? "inline-flex min-h-10 items-center font-semibold text-rust underline underline-offset-2"
                  : "inline-flex min-h-10 items-center text-ink-soft underline underline-offset-2 hover:text-rust"
              }
            >
              {entry.skill}
              <span className="ml-1 text-[11.5px] text-ink-soft">({entry.count})</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
