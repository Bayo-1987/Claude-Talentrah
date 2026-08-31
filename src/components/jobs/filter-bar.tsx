import Link from "next/link";
import type { SkillFacetEntry } from "@/lib/jobs/skill-facet";
import type { Suggestion } from "@/lib/jobs/search-suggestions";
import { SearchCombobox } from "./search-combobox";

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

/**
 * Browse links are hit targets, not text.
 *
 * CLAUDE.md fixes a >=40x40px minimum on every interactive element and
 * records it as a bug this project has already shipped once. These eight
 * links were 18.8px tall — measured in a browser, not inferred from the
 * classes, because the classes looked fine.
 *
 * `min-w-10` is not redundant with `min-h-10`. The skill facet row below
 * already had `min-h-10` and still failed: "sql (38)" measured 39.1 x 40, so
 * the row that looked like the fixed one was itself a hair under on the other
 * axis. Short labels — "Lead" at 25.2px, "Entry" at 28.1px — are the whole
 * reason the rule names both dimensions.
 */
const BROWSE_LINK =
  "inline-flex min-h-10 min-w-10 items-center justify-center underline underline-offset-2";

function browseLink(active: boolean) {
  return active
    ? `${BROWSE_LINK} font-semibold text-rust`
    : `${BROWSE_LINK} text-ink-soft hover:text-rust`;
}

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
  /** Free-text query, matched in memory over the already-fetched board. */
  q?: string;
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
  /**
   * Suggestion values for the search field, built server-side from the board
   * currently in hand. Built from the same set the skill facet counts — the
   * board BEFORE the search term is applied — so suggestions do not collapse
   * to whatever co-occurs with what you have typed so far.
   */
  searchIndex?: Suggestion[];
}

/**
 * Server-rendered. Every chip and toggle is still a plain link that updates the
 * URL — the one client component is the search field's suggestion list, which
 * is additive: with JS off it is the same `<input>` in the same GET form it has
 * always been.
 */
export function FilterBar({
  q,
  tab,
  workType,
  seniority,
  skill,
  skillFacet = [],
  searchIndex = [],
}: FilterBarProps) {
  const base = { tab, workType, seniority, skill, q };

  const applied: { key: keyof typeof base; label: string }[] = [];
  if (workType) applied.push({ key: "workType", label: LABEL[workType] });
  if (seniority) applied.push({ key: "seniority", label: LABEL[seniority] });
  // Lowercase on purpose. `sql` and `communication` are the values the parser
  // actually stored, and the browse row below shows them the same way. Title
  // casing would render "Sql", and a per-skill capitalisation map is a curated
  // list — the exact thing the facet exists to avoid.
  if (skill) applied.push({ key: "skill", label: skill });
  // The search term is a removable segment like any other applied filter —
  // it is a filter, and leaving it out of the instrument would make it the one
  // narrowing the board with no visible way to undo it.
  if (q) applied.push({ key: "q", label: `“${q}”` });

  return (
    <div className="flex flex-col gap-3 border-y border-line py-3">
      {/*
        One instrument, not a scatter of chips (finding 01). The border is the
        control; the hairlines inside are its dividers.

        It used to render only when something was applied, because an empty
        bordered box is a control with nothing in it. That reasoning retired
        with the search field: there is now always something in it, so it
        always renders.

        Scope note: only APPLIED filters live in here. The work-type,
        seniority and skill browse rows below are discovery affordances and
        stay outside it, which is also all the mock ever showed inside — one
        applied skill chip, never the twelve-option list.
      */}
      {/*
        THE LEADING SEGMENT — a segment, not a second box.
        
        A comment here used to note this was "a search field this feed does not
        have". It has one now, and the first version of it shipped as its own
        bordered container stacked above this one. That looked close enough and
        was wrong on the rule this whole control exists to satisfy: finding 01
        is ONE instrument, and two identical 1.5px boxes is a scatter of two.
        tests/jobs/filter-bar.test.tsx caught it.

        A GET form, so the query lives in the URL like every other filter and a
        searched board is shareable and back-buttonable. The hidden inputs
        carry the other filters through — without them, searching would
        silently clear them.

        Consequence worth stating: the instrument now renders ALWAYS, because
        the search field is always available. It is no longer "a box that
        appears when something is applied" but "the board's controls", which is
        what the mock draws. The applied term still appears as its own
        removable segment further along — the input is how you search, the
        segment is how you stop.
      */}
      <div
        data-testid="applied-filters"
        className="flex flex-wrap items-stretch overflow-hidden border-[1.5px] border-ink"
      >
        <form
          method="GET"
          action="/jobs"
          className={`flex min-w-[240px] flex-1 items-stretch ${
            applied.length > 0 ? "border-r border-line" : ""
          }`}
        >
          {tab && <input type="hidden" name="tab" value={tab} />}
          {workType && <input type="hidden" name="workType" value={workType} />}
          {seniority && <input type="hidden" name="seniority" value={seniority} />}
          {skill && <input type="hidden" name="skill" value={skill} />}
          {/*
            The input and its suggestion list. Still the same `name="q"` inside
            this same GET form — the combobox fills it and submits the form,
            rather than introducing a parallel path. See search-combobox.tsx.
          */}
          <SearchCombobox defaultValue={q ?? ""} index={searchIndex} />
          <button
            type="submit"
            className="inline-flex min-h-[42px] min-w-10 items-center justify-center border-l border-line bg-card px-3.5 font-body text-[12.5px] font-semibold text-ink-soft no-underline transition-colors hover:text-rust"
          >
            Search
          </button>
        </form>

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

        {/*
          Still conditional, unlike the container around it. "Clear filters"
          with nothing applied is a button that does nothing — and clearing is
          the one action here that should never be offered when it is a no-op.
        */}
        {applied.length > 0 && (
          <Link
            href={buildHref(base, { workType: undefined, seniority: undefined, skill: undefined, q: undefined })}
            className="flex min-h-[42px] items-center px-3.5 text-[12.5px] font-semibold text-ink-soft no-underline transition-colors hover:text-rust"
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
              className={browseLink(workType === wt)}
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
              className={browseLink(seniority === s)}
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
              className={browseLink(skill === entry.skill)}
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
