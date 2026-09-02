import type { Tables } from "@/lib/supabase/types";

/**
 * The one place a salary is turned into words a seeker reads, so the display
 * rule can never drift from src/lib/seo/job-posting-jsonld.ts's emission
 * rule. Both gate identically: a currency AND at least one bound, or nothing
 * at all. `job-card.tsx` (the feed) and `jobs/[id]/page.tsx` (the detail
 * page) both call this; nowhere else does — see the note at the bottom of
 * this file for why.
 *
 * `en-NG` is the base locale, not `en`/`en-US`: ICU has no dedicated glyph
 * for NGN under a generic English locale and falls back to printing the code
 * ("NGN 500,000"), but `en-NG` renders the Naira sign a Nigerian reader
 * actually expects ("₦500,000") without changing how any other currency
 * renders (USD still reads "US$90,000", an unregistered code like GHS or KES
 * still falls back to its own code-prefix form either way). The product's own
 * market is the tie-breaker here, not a universal "more correct" choice.
 */
const SALARY_LOCALE = "en-NG";

const UNIT_SUFFIX: Record<string, string> = {
  hour: "per hour",
  day: "per day",
  week: "per week",
  month: "per month",
  year: "per year",
};

type SalaryFields = Pick<
  Tables<"job_postings">,
  "salary_min" | "salary_max" | "salary_currency" | "salary_unit"
>;

/** `numeric` columns can arrive as a string over PostgREST — never trust the
 * declared type over what actually came back. */
function toFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A seeker-facing salary line, or null when there is nothing honest to show.
 *
 * THE GATE. Currency AND at least one bound, exactly the condition
 * job-posting-jsonld.ts's `baseSalary` block checks — a bound with no
 * currency is not a fact ("50000" of what?), and this repo does not
 * fabricate the missing half. No "Salary not disclosed" placeholder either:
 * absence is silent here the same way it is silent in the structured data,
 * because a placeholder implies someone chose to withhold it, and for most
 * rows nobody withheld anything — the source simply never stated one.
 *
 * `salary_currency`'s only guarantee is SHAPE (3 uppercase letters — see
 * migration 0085 and sources/schema-org.ts's mapCurrency; there is
 * deliberately no database CHECK), not that it is a currency ICU recognises.
 * `Intl.NumberFormat` validates the same shape and nothing more (confirmed:
 * a well-shaped but unregistered code does not throw, it prints the code
 * itself as the symbol), so this only needs a defensive try/catch as
 * insurance against a future write path that skips validation — not because
 * today's writers can produce a value that trips it.
 */
export function formatSalary(job: SalaryFields): string | null {
  const min = toFiniteNumber(job.salary_min);
  const max = toFiniteNumber(job.salary_max);
  if (!job.salary_currency || (min === undefined && max === undefined)) return null;

  try {
    const formatter = new Intl.NumberFormat(SALARY_LOCALE, {
      style: "currency",
      currency: job.salary_currency,
      maximumFractionDigits: 0,
    });

    let amount: string;
    if (min !== undefined && max !== undefined) {
      amount = min === max ? formatter.format(min) : `${formatter.format(min)} – ${formatter.format(max)}`;
    } else if (min !== undefined) {
      amount = `From ${formatter.format(min)}`;
    } else {
      amount = `Up to ${formatter.format(max!)}`;
    }

    const unit = job.salary_unit ? UNIT_SUFFIX[job.salary_unit] : undefined;
    return unit ? `${amount} ${unit}` : amount;
  } catch {
    // A currency Intl genuinely cannot format is the same "nothing honest to
    // show" case as no currency at all — never render a raw error or a
    // half-formatted number.
    return null;
  }
}

/**
 * WHERE ELSE THIS DOES — AND DOES NOT — APPEAR.
 *
 * Two seeker-facing surfaces render a `job_postings` row today: the feed
 * (job-card.tsx, one JobCard per row) and the detail page
 * (jobs/[id]/page.tsx). Both call formatSalary. Nowhere else does, by
 * decision, not by oversight:
 *
 *   tracker/page.tsx (Job Tracker) — selects only company_name, title,
 *   location, external_url from job_postings, deliberately: its job is
 *   showing application STAGE (saved/applied/interviewing/…), not the
 *   posting's own details. It doesn't show work_type, employment_type or
 *   seniority either, all of which are equally "job detail" information —
 *   adding salary alone would be inconsistent with that existing choice, not
 *   a fix to it. A seeker who wants the job's details follows through to its
 *   card or detail page, both already showing salary.
 *
 *   dashboard/page.tsx — renders no job_postings content at all today.
 *
 *   Farah's chat/match-explanation surfaces — operate on match scores and
 *   structured_jd (skills/keywords), not on the posting's display fields;
 *   salary plays no role in matching and isn't part of what Farah explains.
 *
 * If a future surface adds a job_postings row to its own view, the rule is:
 * showing employment_type/work_type/seniority there already → also show
 * salary via this function; showing none of those → leave salary out too,
 * for the same reason the tracker does.
 */
