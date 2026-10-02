import { inferSeniority, NON_SCREENABLE_SKILLS } from "@/lib/jobs/extract-jd";
import type { SeniorityLevel } from "@/lib/jobs/types";
import type { StructuredResume } from "@/lib/resume/types";
import { expandResumeSkills } from "./resume-skills";
import { classifyRoleFamilies } from "./role-family";
import { capForRoleFit, isBaselineTagScreenable, resumeRoleFamilies, roleFit, type RoleFit } from "./role-fit";

export interface MatchExplanation {
  matchedSkills: string[];
  missingSkills: string[];
  seniorityAlignment: "match" | "above" | "below" | "unknown";
  /**
   * A2: how the job's role family relates to the resume's. Absent on a score computed without the job's title (and on a row stored before
   * this existed, which is recomputed on the next visit). "different" caps the score at 59, "unknown" at 79; see role-fit.ts.
   */
  roleFit?: RoleFit;
  /** The score before the role-fit cap, present only when the cap actually lowered it. */
  scoreBeforeRoleFit?: number;
}

export interface MatchResult {
  score: number;
  explanation: MatchExplanation;
}

const SENIORITY_ORDER: Record<SeniorityLevel, number> = {
  entry: 0,
  mid: 1,
  senior: 2,
  lead: 3,
  executive: 4,
};

function inferResumeSeniority(resume: StructuredResume): SeniorityLevel | undefined {
  // Same latent-crash shape as resume.skills (resume-skills.ts's own
  // comment has the full story): `experience` is typed as required, but an
  // unvalidated stored resume can genuinely lack it. `?.[0]` rather than
  // `[0]` treats that the same as an empty work history — unknown
  // seniority, not a crash.
  const mostRecentTitle = resume.experience?.[0]?.title;
  return mostRecentTitle ? inferSeniority(mostRecentTitle) : undefined;
}

/**
 * Algorithmic (non-LLM) match score, per build-prompt §6.2/§9: skill/keyword
 * coverage of the job's requirements, adjusted for seniority alignment
 * (candidate's most recent title vs. the job's inferred level). No LLM call
 * per job, so this can run for every job in the feed on every request
 * without meaningful cost.
 */
export function computeMatchScore(
  resume: StructuredResume,
  jobSkills: string[],
  jobSeniority: SeniorityLevel | undefined,
  /**
   * The job's title, for the role-family check and the family-gated baseline tags (role-fit.ts). Omitted: neither applies and the score is
   * exactly what it was before A2 (the pure skill-and-seniority number).
   */
  jobTitle?: string,
): MatchResult {
  const jobFamilies = jobTitle === undefined ? undefined : classifyRoleFamilies(jobTitle);
  /*
   * Expanded, not just lowercased. Job skills are canonical by construction
   * and resume skills are whatever the candidate typed, so "SAFe Agile" and
   * "Cloud (AWS, Azure)" never met `agile`, `aws` or `azure` — see
   * resume-skills.ts. The comparison itself stays exact.
   */
  const resumeSkills = expandResumeSkills(resume.skills);

  /*
   * Only the requirements a resume can actually be screened against.
   *
   * `communication`, `leadership` and `operations` are tagged on 57%, 36% and
   * 42% of the live board and have matched zero times across every score ever
   * computed — see NON_SCREENABLE_SKILLS for the measurement. Left in, they
   * are denominator with no reachable numerator: they cap the attainable
   * score on most postings well below the Excellent threshold Auto-Apply gates
   * on, for reasons the candidate cannot act on and the explanation cannot
   * honestly report.
   *
   * They are dropped from the EXPLANATION as well as the arithmetic, and that
   * is the point rather than a side effect. `gapSkills()` renders
   * `missingSkills` to the user as their gap analysis, and listing "you are
   * missing communication" is advice nobody can take — the resume has no field
   * it would go in. A score and a stated reason that disagree is the failure
   * mode worth avoiding here.
   */
  const jobSkillSet = new Set(
    jobSkills
      .map((s) => s.toLowerCase())
      .filter((s) => !NON_SCREENABLE_SKILLS.has(s))
      // Generic baseline tags (project management, agile, ...) only count for the families they are core for (role-fit.ts).
      .filter((s) => jobFamilies === undefined || isBaselineTagScreenable(s, jobFamilies)),
  );

  const matchedSkills = [...jobSkillSet].filter((s) => resumeSkills.has(s));
  const missingSkills = [...jobSkillSet].filter((s) => !resumeSkills.has(s));

  /*
   * No listed requirements to compare against — treat as a neutral 50/100
   * rather than a false 0 or 100.
   *
   * This branch now also catches a posting whose only tagged skills were
   * non-screenable ones, which is the right reading of it: such a posting
   * names nothing a resume can be measured against, so 50 is exactly the
   * "we cannot tell" this branch already existed to express. Scoring it 0
   * would assert a mismatch that was never tested for.
   */
  const skillCoverage =
    jobSkillSet.size > 0 ? matchedSkills.length / jobSkillSet.size : 0.5;

  const resumeSeniority = inferResumeSeniority(resume);
  let seniorityAlignment: MatchExplanation["seniorityAlignment"] = "unknown";
  let seniorityAdjustment = 0;

  if (resumeSeniority && jobSeniority) {
    const diff = Math.abs(
      SENIORITY_ORDER[resumeSeniority] - SENIORITY_ORDER[jobSeniority],
    );
    seniorityAdjustment = diff === 0 ? 5 : diff === 1 ? 0 : -15;
    seniorityAlignment =
      diff === 0
        ? "match"
        : SENIORITY_ORDER[resumeSeniority] > SENIORITY_ORDER[jobSeniority]
          ? "above"
          : "below";
  }

  const rawScore = Math.max(
    0,
    Math.min(100, Math.round(skillCoverage * 100) + seniorityAdjustment),
  );

  const explanation: MatchExplanation = { matchedSkills, missingSkills, seniorityAlignment };
  if (jobFamilies === undefined) return { score: rawScore, explanation };

  // The family check (A2): applied to the STORED score so every consumer (Auto-Apply, the digest, the alert, employer ranking) agrees.
  const fit = roleFit(jobFamilies, resumeRoleFamilies(resume));
  const score = capForRoleFit(rawScore, fit);
  explanation.roleFit = fit;
  if (score < rawScore) explanation.scoreBeforeRoleFit = rawScore;
  return { score, explanation };
}
