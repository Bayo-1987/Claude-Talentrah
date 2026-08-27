import type { MatchExplanation } from "./score";

/**
 * The words behind the job card's free "Vet" actions.
 *
 * Pure and separate from the menu component on purpose: this is the part that
 * has to stay honest, and it is the part a UI test cannot reach once it is
 * buried in component state. Both functions read `match_scores.explanation` —
 * matched skills, missing skills, a seniority read — which is computed
 * algorithmically for the score already on the card. No model call, no
 * credits, nothing stored.
 *
 * THE BANDS MUST MATCH THE TIER SYSTEM. CLAUDE.md fixes exactly three tiers
 * (Excellent 80+, Good 70–79, Fair 60–69) and forbids a fourth, and the
 * match-tier wording has to agree on every screen. These sentences deliberately
 * describe the band in prose rather than repeat the tier label, because the
 * label is already on the card two inches away — saying "Excellent" twice reads
 * as a system talking to itself.
 */

const SENIORITY_READ: Record<MatchExplanation["seniorityAlignment"], string> = {
  match: "the seniority looks right for you",
  above: "it sits above your current level",
  below: "it sits below your current level",
  unknown: "the seniority isn't clear from the posting",
};

export function scoreBand(score: number): string {
  if (score >= 80) return "a strong match";
  if (score >= 70) return "a good match";
  if (score >= 60) return "a fair match";
  return "a weak match";
}

/** The headline read: band + seniority + how many named skills already match. */
export function fitSummary(score: number, explanation: MatchExplanation): string {
  const matched = explanation.matchedSkills?.length ?? 0;
  const skills =
    matched > 0
      ? `You already match ${matched} of the skills it names.`
      : "None of the skills it names are on your resume yet.";
  return `${scoreBand(score)}, and ${SENIORITY_READ[explanation.seniorityAlignment]}. ${skills}`;
}

/**
 * The itemised half. Returns the skills the posting names that the resume does
 * not, or null when there are none — the caller says something different in
 * that case rather than rendering an empty list, because an empty "Gap
 * analysis" reads as broken rather than as good news.
 */
export function gapSkills(explanation: MatchExplanation): string[] | null {
  const missing = explanation.missingSkills ?? [];
  return missing.length > 0 ? missing : null;
}
