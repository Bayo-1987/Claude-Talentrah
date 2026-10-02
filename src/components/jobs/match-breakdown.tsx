import type { MatchExplanation } from "@/lib/matching/score";
import { hasNoScreenableSkills, isThinScreenableTagSet } from "@/lib/match-tier";

/**
 * Stage 8's display-only first step: sub-scores instead of one opaque number. Both already exist in every score this app
 * computes: `matchedSkills`/`missingSkills` (skill coverage) and `seniorityAlignment`.
 *
 * A CELL RENDERS ONLY WHEN IT CARRIES A REAL VALUE (S3-23a). This used to end with a third cell, "Industry alignment: Not yet
 * measured, flagged, not scored", on every card, and showed "Not available" when seniority was unknown. A placeholder repeated
 * on every job reads as "this product is unfinished" and draws the eye from the cells that carry information. Both are gone:
 * an unknown seniority simply has no cell, and what is not measured yet (industry) is said ONCE, on the "How match scores
 * work" page (/how-match-scores-work), linked from the feed and the job page rather than repeated per card.
 *
 * NO SCORING CHANGE. This reads the same `MatchExplanation` the score and `fitSummary`/`gapSkills` (vet-summary.ts) already
 * read: a second rendering of existing data, not a new computation. NOT A FOURTH TIER: no match-tier color appears here.
 */
export function MatchBreakdown({ explanation }: { explanation: MatchExplanation }) {
  const matched = explanation.matchedSkills.length;
  const total = matched + explanation.missingSkills.length;

  return (
    <div className="flex border-y border-line py-2.5 text-[12.5px]">
      <BreakdownItem
        label="Skill coverage"
        value={`${matched} of ${total} tag${total === 1 ? "" : "s"}`}
        sub={skillCoverageSub(matched, total, explanation.matchedSkills)}
      />
      {explanation.seniorityAlignment !== "unknown" && (
        <BreakdownItem label="Seniority" value={SENIORITY_VALUE_LABEL[explanation.seniorityAlignment]} />
      )}
      {explanation.roleFit && explanation.roleFit !== "unknown" && (
        <BreakdownItem label="Role fit" value={ROLE_FIT_VALUE_LABEL[explanation.roleFit]} />
      )}
    </div>
  );
}

const SENIORITY_VALUE_LABEL: Record<Exclude<MatchExplanation["seniorityAlignment"], "unknown">, string> = {
  match: "Match",
  above: "Above",
  below: "Below",
};

/**
 * A2: the role-family check (role-fit.ts). Only the three words, and no cell when either the job or the resume classifies as
 * nothing ("unknown") or the score was computed without a title. Neutral ink, never a match-tier color: it is not a fourth tier.
 */
const ROLE_FIT_VALUE_LABEL: Record<Exclude<NonNullable<MatchExplanation["roleFit"]>, "unknown">, string> = {
  same: "Same family",
  adjacent: "Adjacent",
  different: "Different",
};

/**
 * Names what little there is when the denominator is thin — the exact
 * distribution problem Stage 8 measured (57.6% of the board scores on 0-2
 * screenable tags). Making a thin denominator VISIBLE is itself useful,
 * independent of whether the count is ever raised.
 *
 * The threshold itself lives in `isThinScreenableTagSet` (match-tier.ts),
 * shared with `MatchTierBadge`'s own "Excellent — thin match" qualifier, so
 * this line and the topline tier label can never disagree about what counts
 * as thin.
 */
function skillCoverageSub(matched: number, total: number, matchedSkills: string[]): string | undefined {
  if (hasNoScreenableSkills(total)) return "no screenable skills listed";
  if (!isThinScreenableTagSet(total)) return undefined;
  if (matched === 0) return "thin — none of the named skills matched";
  const names = matchedSkills.map((s) => `"${s}"`).join(", ");
  return `only ${names} — thin`;
}

function BreakdownItem({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5 border-l border-line pl-4 first:border-l-0 first:pl-0">
      <span className="font-body text-[10px] font-bold tracking-[0.11em] text-ink-soft uppercase">{label}</span>
      <span className="text-[13.5px] font-semibold text-ink">{value}</span>
      {sub && <span className="text-[11.5px] text-ink-soft">{sub}</span>}
    </div>
  );
}
