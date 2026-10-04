import type { MatchExplanation } from "./score";

/**
 * The ONE place `seniorityAlignment` is turned into words. Every consumer (the job card and detail-page breakdown, the Vet summary, Farah's job
 * context) uses it, and tests/matching/seniority-words.test.tsx fails if any other file maps these values to words.
 *
 * WHAT THE VALUES MEAN (set in score.ts, comparing the RESUME's level with the JOB's):
 *   match    the resume's level equals the job's
 *   above    the resume's level is HIGHER than the job's  -> the role is MORE JUNIOR than you
 *   below    the resume's level is LOWER than the job's   -> the role is MORE SENIOR than you
 *   unknown  one side's level could not be told
 * Before this helper existed, two places worded "above"/"below" about the JOB ("it sits above/below your current level") while the scorer meant
 * them about the RESUME, so every mismatch read the wrong way round. The words here always say which way the role sits relative to the user.
 */
type Alignment = MatchExplanation["seniorityAlignment"];
export type SeniorityPerspective = "seeker" | "employer";

type Words = { sentence: string; label: string | null };

/** Written to the JOB SEEKER ("you" is the person whose resume was scored). */
const SEEKER: Record<Alignment, Words> = {
  match: { sentence: "the seniority looks right for you", label: "Match" },
  above: { sentence: "it is more junior than your current level", label: "More junior than you" },
  below: { sentence: "it is more senior than your current level", label: "More senior than you" },
  // No label: an unknown level shows no cell on the card (a field appears only when it carries a real value).
  unknown: { sentence: "the seniority isn't clear from the posting", label: null },
};

/**
 * Written to the EMPLOYER, about the APPLICANT and the role (there is no "you": it would be the employer, and the direction would be the other
 * way round). "above" is the same fact as for the seeker, the resume's level exceeds the role's, so it reads "Above the role's level".
 */
const EMPLOYER: Record<Alignment, Words> = {
  match: { sentence: "the applicant's level matches the role's", label: "Match" },
  above: { sentence: "the applicant's level is above the role's", label: "Above the role's level" },
  below: { sentence: "the applicant's level is below the role's", label: "Below the role's level" },
  unknown: { sentence: "the level is not clear from the posting or the resume", label: null },
};

/** `sentence` is lower-case and mid-sentence (the summary capitalises it); `label` is the short value for the breakdown cell, or null for none. */
export function describeSeniorityAlignment(alignment: Alignment, perspective: SeniorityPerspective = "seeker"): Words {
  return (perspective === "employer" ? EMPLOYER : SEEKER)[alignment];
}
