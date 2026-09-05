import Link from "next/link";
import type { Suggestion } from "@/lib/jobs/search-suggestions";
import { SearchCombobox } from "./search-combobox";
import { FilterMenu, type FilterMenuItem } from "./filter-menu";
import { JOB_DATE_FILTERS, JOB_DATE_FILTER_LABEL, type JobDateFilter } from "@/lib/jobs/freshness";
import { TRACKED_COUNTRIES, type TrackedCountry } from "@/lib/jobs/country";

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
  ...JOB_DATE_FILTER_LABEL,
};

/**
 * Browse links are hit targets, not text.
 *
 * CLAUDE.md fixes a >=40x40px minimum on every interactive element and
 * records it as a bug this project has already shipped once. These links
 * were 18.8px tall — measured in a browser, not inferred from the classes,
 * because the classes looked fine.
 *
 * `min-w-10` is not redundant with `min-h-10`. Short labels — "Lead" at
 * 25.2px, "Entry" at 28.1px — are the whole reason the rule names both
 * dimensions.
 */
const BROWSE_LINK =
  "inline-flex min-h-10 min-w-10 items-center justify-center whitespace-nowrap underline underline-offset-2";

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

/** Adds `value` if it isn't in `current`, removes it if it is — one click, one toggle. */
function toggled(current: readonly string[], value: string): string[] {
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
}

export interface FilterBarProps {
  /** Free-text query, matched in memory over the already-fetched board. */
  q?: string;
  tab: string;
  /** Multi-select (Part 2) — both can be active at once, e.g. Remote + Hybrid. */
  workTypes?: string[];
  seniorities?: string[];
  /**
   * Suggestion values for the search field, built server-side from the board
   * currently in hand. Built from the board BEFORE the search term is
   * applied — so suggestions do not collapse to whatever co-occurs with what
   * you have typed so far.
   */
  searchIndex?: Suggestion[];
  /**
   * The user's chosen narrower window, layered on top of the ambient 30-day
   * floor every tab already applies (src/lib/jobs/freshness.ts) — undefined
   * means "just the floor", not "no filter at all". Single-value: two time
   * windows is meaningless, since the wider always wins.
   */
  posted?: JobDateFilter;
  /**
   * The EFFECTIVE country in play, whether from an explicit `?country=`
   * param or defaulted from the signed-in user's profile.country
   * (jobs/page.tsx computes both into one value before this ever sees it).
   * `undefined` covers two different cases this component cannot tell apart
   * on its own — see `countryApplicable` below for why that distinction
   * still matters. Single-value: two countries has no coherent default.
   */
  country?: TrackedCountry;
  /**
   * True whenever country is a real concept for this user in this render —
   * jobs/page.tsx's countryState is "kept" or "cleared", not "none". `country`
   * alone can't carry this: it's ALSO undefined right after an explicit
   * clear, which looks identical to "no profile default exists at all"
   * unless this is passed separately. The distinction matters for "Clear
   * filters": it must keep re-asserting `country=all` for a user who already
   * cleared it, or clicking Clear filters to drop an unrelated filter would
   * silently let the country default reassert itself — exactly the
   * invisible-behaviour this feature exists to rule out.
   */
  countryApplicable?: boolean;
  /**
   * Per-tracked-country counts, computed by jobs/page.tsx against the board
   * as it stands under every OTHER active filter — work type, seniority,
   * posted, search — but before country itself narrows it. "Under whatever
   * else is applied", so a number shown here is a promise the next screen
   * (which keeps every other filter active) actually keeps.
   */
  countryCounts?: Record<TrackedCountry, number>;
  /** The "Every country" row's own count — the same board, no country restriction at all. */
  everyCountryCount?: number;
}

/**
 * The jobs feed's filter controls.
 *
 * Server-rendered. Every control is still a plain link or native
 * `<details>`/`<summary>` that updates the URL — the one client component is
 * the search field's suggestion list and the menu's keyboard polish
 * (search-combobox.tsx, filter-menu.tsx), both additive: with JS off this is
 * the same GET-driven links-and-inputs page it has always been.
 */
export function FilterBar({
  q,
  tab,
  workTypes = [],
  seniorities = [],
  posted,
  country,
  countryApplicable = false,
  countryCounts,
  everyCountryCount,
  searchIndex = [],
}: FilterBarProps) {
  const workTypeParam = workTypes.length ? workTypes.join(",") : undefined;
  const seniorityParam = seniorities.length ? seniorities.join(",") : undefined;
  const base = { tab, workType: workTypeParam, seniority: seniorityParam, q, posted, country };

  const anyApplied =
    workTypes.length > 0 || seniorities.length > 0 || !!posted || !!country || !!q;

  /*
   * Country menu content — one set of items, rendered by TWO <FilterMenu>
   * instances below (the desktop leading control and the mobile row). Native
   * `display:none` on whichever one the breakpoint hides takes it out of the
   * tab order and the accessibility tree on its own — the same pattern
   * employer-masthead.tsx already uses for its own responsive nav, so this
   * isn't a new kind of duplication in this codebase.
   */
  const countryItems: FilterMenuItem[] = TRACKED_COUNTRIES.map((c) => ({
    href: buildHref(base, { country: country === c ? "all" : c }),
    label: c,
    selected: country === c,
    count: countryCounts?.[c],
  }));
  const countrySentinel: FilterMenuItem = {
    href: buildHref(base, { country: "all" }),
    label: "Every country",
    selected: !country,
    count: everyCountryCount,
  };
  // The button's own face always shows the live value — the default is
  // visible and reversible, never invisible behaviour.
  const countryFace = country ?? "Every country";

  const workTypeItems: FilterMenuItem[] = WORK_TYPES.map((wt) => ({
    href: buildHref(base, { workType: toggled(workTypes, wt).join(",") || undefined }),
    label: LABEL[wt],
    selected: workTypes.includes(wt),
  }));
  const seniorityItems: FilterMenuItem[] = SENIORITIES.map((s) => ({
    href: buildHref(base, { seniority: toggled(seniorities, s).join(",") || undefined }),
    label: LABEL[s],
    selected: seniorities.includes(s),
  }));
  const postedItems: FilterMenuItem[] = JOB_DATE_FILTERS.map((d) => ({
    href: buildHref(base, { posted: posted === d ? undefined : d }),
    label: LABEL[d],
    selected: posted === d,
  }));

  return (
    <div className="flex flex-col gap-3 border-y border-line py-3">
      {/*
        THE SEARCH INSTRUMENT — unchanged shape from before Part 3, minus the
        per-filter chip row. Work type, seniority, posted and country now show
        their own applied state directly (a rust link, a menu button's own
        face) — a second, redundant display of the same state inside this box
        was the "applied-filter chip row" that's gone. "Clear filters" is the
        one thing left in here with no other affordance, so it stays.
      */}
      <div
        data-testid="applied-filters"
        className="flex flex-wrap items-stretch overflow-hidden border-[1.5px] border-ink"
      >
        <form
          method="GET"
          action="/jobs"
          className={`flex min-w-[240px] flex-1 items-stretch ${anyApplied ? "border-r border-line" : ""}`}
        >
          {tab && <input type="hidden" name="tab" value={tab} />}
          {workTypeParam && <input type="hidden" name="workType" value={workTypeParam} />}
          {seniorityParam && <input type="hidden" name="seniority" value={seniorityParam} />}
          {posted && <input type="hidden" name="posted" value={posted} />}
          {country && <input type="hidden" name="country" value={country} />}
          <SearchCombobox defaultValue={q ?? ""} index={searchIndex} />
          <button
            type="submit"
            className="inline-flex min-h-[42px] min-w-10 items-center justify-center border-l border-line bg-card px-3.5 font-body text-[12.5px] font-semibold text-ink-soft no-underline transition-colors hover:text-rust"
          >
            Search
          </button>
        </form>

        {anyApplied && (
          <Link
            href={buildHref(base, {
              workType: undefined,
              seniority: undefined,
              q: undefined,
              posted: undefined,
              // Only when country is actually a concept for this user —
              // see countryApplicable's own doc comment for why this can't
              // just check `country` itself.
              country: countryApplicable ? "all" : undefined,
            })}
            className="flex min-h-[42px] items-center px-3.5 text-[12.5px] font-semibold text-ink-soft no-underline transition-colors hover:text-rust"
          >
            Clear filters
          </Link>
        )}
      </div>

      {/*
        DESKTOP — one row, Country leading as the only bordered menu, then
        Work type / Seniority / Posted as plain inline links with no labels: a
        hairline column rule between groups (border-l on each span after the
        first) carries the grouping the labels used to. `flex-nowrap` is
        deliberate, not decorative — this was measured to fit inside the
        1120px content column (≈890px used of 996px available) and the
        944px narrow-laptop case (≈55px to spare); wrapping here silently
        would mean the row no longer does what it was built to.
      */}
      <div className="hidden min-[901px]:flex min-[901px]:flex-nowrap min-[901px]:items-center min-[901px]:gap-4">
        <FilterMenu faceLabel={countryFace} items={countryItems} sentinel={countrySentinel} />
        <span className="flex items-center gap-3.5 border-l border-line pl-4">
          {WORK_TYPES.map((wt) => (
            <Link
              key={wt}
              href={buildHref(base, { workType: toggled(workTypes, wt).join(",") || undefined })}
              className={browseLink(workTypes.includes(wt))}
            >
              {LABEL[wt]}
            </Link>
          ))}
        </span>
        <span className="flex items-center gap-3.5 border-l border-line pl-4">
          {SENIORITIES.map((s) => (
            <Link
              key={s}
              href={buildHref(base, { seniority: toggled(seniorities, s).join(",") || undefined })}
              className={browseLink(seniorities.includes(s))}
            >
              {LABEL[s]}
            </Link>
          ))}
        </span>
        <span className="flex items-center gap-3.5 border-l border-line pl-4">
          {JOB_DATE_FILTERS.map((d) => (
            <Link
              key={d}
              href={buildHref(base, { posted: posted === d ? undefined : d })}
              className={browseLink(posted === d)}
            >
              {LABEL[d]}
            </Link>
          ))}
        </span>
      </div>

      {/*
        PHONE/NARROW — below ~900px the three link groups have nowhere to go,
        so they become menus matching Country's own. Same URLs, same server
        code, same `toggled()` — only the control changes, per the design
        spec's own "one source of truth, two renderings" rule. Multi-select
        still works here: each tick is its own navigation (no JS holds the
        menu's array state client-side, so the same server-computed `items`
        that back the desktop links back these), so two ticks take two opens
        of the menu rather than one, which is the honest cost of shipping no
        client-side filter state at all.
      */}
      <div className="flex flex-wrap items-center gap-2.5 min-[901px]:hidden">
        <FilterMenu faceLabel={countryFace} items={countryItems} sentinel={countrySentinel} />
        <FilterMenu
          faceLabel="Work type"
          ariaLabel="Work type"
          items={workTypeItems}
          variant="quiet"
        />
        <FilterMenu
          faceLabel="Seniority"
          ariaLabel="Seniority"
          items={seniorityItems}
          variant="quiet"
        />
        <FilterMenu faceLabel="Posted" ariaLabel="Posted" items={postedItems} variant="quiet" />
      </div>
    </div>
  );
}
