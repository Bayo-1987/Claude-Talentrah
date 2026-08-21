import { inferSeniority } from "@/lib/jobs/extract-jd";
import type { SeniorityLevel } from "@/lib/jobs/types";
import type { StructuredResume } from "@/lib/resume/types";

export interface MatchExplanation {
  matchedSkills: string[];
  missingSkills: string[];
  seniorityAlignment: "match" | "above" | "below" | "unknown";
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
  const mostRecentTitle = resume.experience[0]?.title;
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
): MatchResult {
  const resumeSkills = new Set(resume.skills.map((s) => s.toLowerCase()));
  const jobSkillSet = new Set(jobSkills.map((s) => s.toLowerCase()));

  const matchedSkills = [...jobSkillSet].filter((s) => resumeSkills.has(s));
  const missingSkills = [...jobSkillSet].filter((s) => !resumeSkills.has(s));

  // No listed requirements to compare against — treat as a neutral 50/100
  // rather than a false 0 or 100.
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

  const score = Math.max(
    0,
    Math.min(100, Math.round(skillCoverage * 100) + seniorityAdjustment),
  );

  return {
    score,
    explanation: { matchedSkills, missingSkills, seniorityAlignment },
  };
}
