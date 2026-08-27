import Link from "next/link";
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

  const applied: { key: keyof typeof base; label: string }[] = [];
  if (workType) applied.push({ key: "workType", label: LABEL[workType] });
  if (seniority) applied.push({ key: "seniority", label: LABEL[seniority] });
  // Lowercase on purpose. `sql` and `communication` are the values the parser
  // actually stored, and the browse row below shows them the same way. Title
  // casing would render "Sql", and a per-skill capitalisation map is a curated
  // list — the exact thing the facet exists to avoid.
  if (skill) applied.push({ key: "skill", label: skill });

  return (
    <div className="flex flex-col gap-3 border-y border-line py-3">
      {/*
        One instrument, not a scatter of chips (finding 01). The border is the
        control; the hairlines inside are its dividers. It renders only when
        something is applied — an empty bordered box would be a control with
        nothing in it, and the mock's leading segment is a search field this
        feed does not have.

        Scope note: only APPLIED filters live in here. The work-type,
        seniority and skill browse rows below are discovery affordances and
        stay outside it, which is also all the mock ever showed inside — one
        applied skill chip, never the twelve-option list.
      */}
      {applied.length > 0 && (
        <div className="flex flex-wrap items-stretch overflow-hidden border-[1.5px] border-ink">
          {applied.map(({ key, label }) => (
            <Link
              key={key}
              href={buildHref(base, { [key]: undefined })}
              aria-label={`Remove ${label} filter`}
              /*
                The whole segment is the remove target, not the 9px glyph. The
                mock draws the x as decoration inside a span; at 9 x 9 that is
                a quarter of the 40x40 minimum CLAUDE.md fixes, and shipping a
                glyph-sized hit area is a bug this project has already had once.
              */
              className="flex min-h-[42px] items-center gap-2 border-r border-line px-3.5 text-[12.5px] font-semibold text-ink-soft no-underline transition-colors last:border-r-0 hover:text-rust"
            >
              {label}
              <svg width="9" height="9" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M4 4 L16 16 M16 4 L4 16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </Link>
          ))}
          <Link
            href={buildHref(base, { workType: undefined, seniority: undefined, skill: undefined })}
            className="flex min-h-[42px] items-center px-3.5 text-[12.5px] font-semibold text-ink-soft no-underline transition-colors hover:text-rust"
          >
            Clear filters
          </Link>
        </div>
      )}
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
