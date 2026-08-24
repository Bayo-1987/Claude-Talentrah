import Link from "next/link";
import { FilterChip } from "@/components/ui";
import { DEGREE_LEVEL_LABEL, FUNDING_TYPE_LABEL } from "@/lib/scholarships/types";

const DEGREE_LEVELS = ["bsc", "msc", "phd", "postgraduate_diploma", "other"] as const;
const FUNDING_TYPES = ["full", "partial"] as const;
const DEADLINE_WINDOWS = [
  { value: "30", label: "Next 30 days" },
  { value: "90", label: "Next 3 months" },
  { value: "180", label: "Next 6 months" },
] as const;

export interface ScholarshipFilterBarProps {
  tab: string;
  level?: string;
  funding?: string;
  within?: string;
  field?: string;
  q?: string;
}

function buildHref(
  base: Record<string, string | undefined>,
  changes: Record<string, string | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...base, ...changes })) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/scholarships?${qs}` : "/scholarships";
}

const WINDOW_LABEL: Record<string, string> = Object.fromEntries(
  DEADLINE_WINDOWS.map((w) => [w.value, w.label]),
);

/**
 * Same server-rendered, zero-client-JS filter pattern as the Job Feed's
 * FilterBar (§6.2) — every chip is a plain link that rewrites the URL.
 * Deliberately not a new interaction model, and deliberately light on the
 * wire given §8's low-end-Android/expensive-data constraint.
 */
export function ScholarshipFilterBar({
  tab,
  level,
  funding,
  within,
  field,
  q,
}: ScholarshipFilterBarProps) {
  const base = { tab, level, funding, within, field, q };
  const anyActive = !!(level || funding || within || field);

  return (
    <div className="flex flex-col gap-3 border-y border-line py-3">
      <form action="/scholarships" className="flex flex-wrap items-center gap-2">
        {tab && tab !== "all" && <input type="hidden" name="tab" value={tab} />}
        {level && <input type="hidden" name="level" value={level} />}
        {funding && <input type="hidden" name="funding" value={funding} />}
        {within && <input type="hidden" name="within" value={within} />}
        {field && <input type="hidden" name="field" value={field} />}
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search provider, programme, or field"
          aria-label="Search scholarships"
          className="min-h-10 w-full max-w-[340px] border-[1.5px] border-ink bg-card px-3 font-body text-[13.5px] text-ink outline-none focus:border-rust"
        />
        <button
          type="submit"
          className="min-h-10 border-[1.5px] border-ink bg-ink px-4 font-body text-[13px] font-semibold text-paper transition-colors hover:bg-rust hover:border-rust"
        >
          Search
        </button>
      </form>

      {(anyActive || q) && (
        <div className="flex flex-wrap items-center gap-2">
          {q && <FilterChip label={`“${q}”`} />}
          {level && <FilterChip label={DEGREE_LEVEL_LABEL[level as keyof typeof DEGREE_LEVEL_LABEL]} />}
          {funding && (
            <FilterChip label={FUNDING_TYPE_LABEL[funding as keyof typeof FUNDING_TYPE_LABEL]} />
          )}
          {within && <FilterChip label={WINDOW_LABEL[within] ?? `Within ${within} days`} />}
          {field && <FilterChip label={field} />}
          <Link
            href={buildHref({ tab }, {})}
            className="text-[12.5px] font-semibold text-ink-soft underline underline-offset-2 hover:text-rust"
          >
            Clear filters
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-ink-soft">Level:</span>
          {DEGREE_LEVELS.map((l) => (
            <Link
              key={l}
              href={buildHref(base, { level: level === l ? undefined : l })}
              className={
                level === l
                  ? "font-semibold text-rust underline underline-offset-2"
                  : "text-ink-soft underline underline-offset-2 hover:text-rust"
              }
            >
              {DEGREE_LEVEL_LABEL[l]}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-ink-soft">Funding:</span>
          {FUNDING_TYPES.map((f) => (
            <Link
              key={f}
              href={buildHref(base, { funding: funding === f ? undefined : f })}
              className={
                funding === f
                  ? "font-semibold text-rust underline underline-offset-2"
                  : "text-ink-soft underline underline-offset-2 hover:text-rust"
              }
            >
              {FUNDING_TYPE_LABEL[f]}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-ink-soft">Deadline:</span>
          {DEADLINE_WINDOWS.map((w) => (
            <Link
              key={w.value}
              href={buildHref(base, { within: within === w.value ? undefined : w.value })}
              className={
                within === w.value
                  ? "font-semibold text-rust underline underline-offset-2"
                  : "text-ink-soft underline underline-offset-2 hover:text-rust"
              }
            >
              {w.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
