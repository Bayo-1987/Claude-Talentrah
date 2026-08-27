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
 * THESE SENTENCES SAY NOTHING ABOUT MATCH QUALITY, and that is the rule rather
 * than a style choice. CLAUDE.md fixes three tiers and forbids prose that
 * restates them — naming `"a good match"` specifically as the thing not to
 * write. The first version of this file described the band in prose ("a strong
 * match", "a good match") on the theory that avoiding the LABEL was enough. It
 * was not: the rule is about the phrase, and paraphrasing a tier is exactly the
 * fourth-tier-by-the-back-door the rule exists to stop.
 *
 * So the band is gone rather than reworded. The card already shows the
 * percentage and the tier badge inches away; the sentence only adds what is
 * NOT already on screen — seniority alignment and how many named skills the
 * resume already covers.
 */

const SENIORITY_READ: Record<MatchExplanation["seniorityAlignment"], string> = {
  match: "the seniority looks right for you",
  above: "it sits above your current level",
  below: "it sits below your current level",
  unknown: "the seniority isn't clear from the posting",
};

/**
 * The headline read: seniority alignment, then how many named skills already
 * match. Takes no score — see the note above on why match quality is absent.
 */
export function fitSummary(explanation: MatchExplanation): string {
  const matched = explanation.matchedSkills?.length ?? 0;
  const skills =
    matched > 0
      ? `You already match ${matched} of the skills it names.`
      : "None of the skills it names are on your resume yet.";
  const seniority = SENIORITY_READ[explanation.seniorityAlignment];
  return `${seniority.charAt(0).toUpperCase()}${seniority.slice(1)}. ${skills}`;
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
