import type { MatchExplanation } from "@/lib/matching/score";
import { isThinScreenableTagSet } from "@/lib/match-tier";

/**
 * Stage 8's display-only first step: three sub-scores instead of one opaque
 * number. Two of the three already exist in every score this app computes —
 * `matchedSkills`/`missingSkills` (skill coverage) and `seniorityAlignment` —
 * discarded on the way to the card until now. Industry alignment is the one
 * signal that doesn't exist yet; reporting it as "Not yet measured" is more
 * honest than staying silent about it.
 *
 * NO SCORING CHANGE. This reads the same `MatchExplanation` the score and
 * `fitSummary`/`gapSkills` (vet-summary.ts) already read — it adds a second
 * rendering of existing data, not a new computation.
 *
 * NOT A FOURTH TIER. "Not yet measured" renders in neutral `ink-soft`, not
 * `--amber` — the mockup this was built from used amber for that value, but
 * amber is one of the three real match-tier colors (see match-tier.ts), and
 * a differently-colored fourth cell here would read as a fourth tier the
 * moment a real Industry Alignment value starts appearing next to it.
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
      <BreakdownItem
        label="Seniority"
        value={SENIORITY_VALUE_LABEL[explanation.seniorityAlignment]}
      />
      <BreakdownItem label="Industry alignment" value="Not yet measured" sub="flagged, not scored" muted />
    </div>
  );
}

const SENIORITY_VALUE_LABEL: Record<MatchExplanation["seniorityAlignment"], string> = {
  match: "Match",
  above: "Above",
  below: "Below",
  unknown: "Not available",
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
  if (total === 0) return "no screenable skills listed";
  if (!isThinScreenableTagSet(total)) return undefined;
  if (matched === 0) return "thin — none of the named skills matched";
  const names = matchedSkills.map((s) => `"${s}"`).join(", ");
  return `only ${names} — thin`;
}

function BreakdownItem({
  label,
  value,
  sub,
  muted = false,
}: {
  label: string;
  value: string;
  sub?: string;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col gap-0.5 border-l border-line pl-4 first:border-l-0 first:pl-0">
      <span className="font-body text-[10px] font-bold tracking-[0.11em] text-ink-soft uppercase">{label}</span>
      <span className={`text-[13.5px] font-semibold ${muted ? "text-ink-soft" : "text-ink"}`}>{value}</span>
      {sub && <span className="text-[11.5px] text-ink-soft">{sub}</span>}
    </div>
  );
}
