import type { StructuredResume } from "@/lib/resume/types";
import { areAdjacent, classifyRoleFamilies, type RoleFamily } from "./role-family";

/**
 * A2: does the job's KIND of role match the resume's, and what that does to a match score.
 *
 * Why it exists. A skill-overlap score cannot see that a Product Manager resume and a Global MEL Manager posting are different jobs:
 * both name "project management", so the pair scored "99% Excellent" (the reported case, docs/match-confidence-invariant.md). The thin-match
 * cap stopped the label overclaiming but not the pairing itself. This is the check that does: classify both sides into role families
 * (role-family.ts) and cap the score when they do not meet.
 *
 *   same       a job family is a resume family
 *   adjacent   no shared family, but one job family sits next to one resume family (one hop, see ADJACENCY)
 *   different  both sides classify and nothing is the same or adjacent  -> the score caps at 59, below the 60 display floor
 *   unknown    either side classifies as nothing                       -> the score keeps its value up to 79 (Good), so it can never
 *                                                                          be Excellent or reach Auto-Apply
 *
 * The caps are applied to the STORED score (computeMatchScore), not only at display, because Auto-Apply, the digest, the proactive alert
 * and the employer applicant ranking all read `match_scores.score`: capping it once means every consumer agrees and none can forget.
 */
export type RoleFit = "same" | "adjacent" | "different" | "unknown";

/** The families a resume's experience titles carry: every role contributes every family it has, once. */
export function resumeRoleFamilies(resume: StructuredResume): RoleFamily[] {
  const found = new Set<RoleFamily>();
  // `experience` is typed as required but an unvalidated stored resume can lack it (same latent shape as resume-skills.ts).
  for (const entry of resume.experience ?? []) {
    if (entry?.title) for (const f of classifyRoleFamilies(entry.title)) found.add(f);
  }
  return [...found];
}

export function roleFit(jobFamilies: RoleFamily[], resumeFamilies: RoleFamily[]): RoleFit {
  if (jobFamilies.length === 0 || resumeFamilies.length === 0) return "unknown";
  if (jobFamilies.some((j) => resumeFamilies.includes(j))) return "same";
  if (jobFamilies.some((j) => resumeFamilies.some((r) => areAdjacent(j, r)))) return "adjacent";
  return "different";
}

/** Below the 60 display floor for a different family; Good (the top of its band) for an unclassified one. */
export const ROLE_FIT_CAP = { different: 59, unknown: 79 } as const;

export function capForRoleFit(score: number, fit: RoleFit): number {
  if (fit === "different") return Math.min(score, ROLE_FIT_CAP.different);
  if (fit === "unknown") return Math.min(score, ROLE_FIT_CAP.unknown);
  return score;
}

/**
 * Generic tags that nearly every resume carries, so naming one proves little: they only count in the denominator for the families they
 * are core for. Everywhere else they are dropped, like NON_SCREENABLE_SKILLS, from the arithmetic and from the explanation.
 */
const BASELINE_TAG_CORE_FAMILIES: Record<string, RoleFamily[]> = {
  "project management": ["program", "product"],
  agile: ["program", "product"],
  scrum: ["program", "product"],
  "stakeholder management": ["program", "product"],
  "microsoft office": ["operations"],
  excel: ["operations"],
};

export const BASELINE_TAGS: ReadonlySet<string> = new Set(Object.keys(BASELINE_TAG_CORE_FAMILIES));

export function isBaselineTagScreenable(tag: string, jobFamilies: RoleFamily[]): boolean {
  const core = BASELINE_TAG_CORE_FAMILIES[tag.toLowerCase()];
  if (!core) return true;
  return jobFamilies.some((f) => core.includes(f));
}
