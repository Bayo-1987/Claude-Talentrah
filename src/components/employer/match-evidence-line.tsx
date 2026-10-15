import { matchEvidenceLine } from "@/lib/match-tier";

/**
 * The one line under a low applicant score (SCORE-EXPLANATION-LINE-1). All the wording and the rule for when it appears live in `matchEvidenceLine` (match-tier.ts); this only renders it,
 * as plain text in the page's secondary-text colour (text-ink-soft) so it is read by screen readers and has the same contrast as the other secondary text. Renders nothing at all when there is no line.
 */
export function MatchEvidenceLine({ score, explanation }: { score: number | null; explanation: unknown }) {
  const line = matchEvidenceLine(score, explanation);
  if (!line) return null;
  return <span className="font-body text-[12px] text-ink-soft">{line}</span>;
}
