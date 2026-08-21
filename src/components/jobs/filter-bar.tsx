import Link from "next/link";
import { FilterChip } from "@/components/ui";

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
}

/** Server-rendered, no client JS: every chip/toggle is a plain link that updates the URL. */
export function FilterBar({ tab, workType, seniority }: FilterBarProps) {
  const base = { tab, workType, seniority };

  return (
    <div className="flex flex-col gap-3 border-y border-line py-3">
      <div className="flex flex-wrap items-center gap-2">
        {workType && (
          <FilterChip
            label={LABEL[workType]}
          />
        )}
        {seniority && <FilterChip label={LABEL[seniority]} />}
        {(workType || seniority) && (
          <Link
            href={buildHref(base, { workType: undefined, seniority: undefined })}
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
    </div>
  );
}
