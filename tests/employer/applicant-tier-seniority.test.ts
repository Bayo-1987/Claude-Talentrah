/**
 * The employer applicants page passes each applicant's `seniority_alignment` (from the employer_job_applicants RPC) into an explanation and
 * then into `effectiveTierFor` (the tier chips and the badge). S3-52 part 1 asked: does that maths treat "above" and "below" the way score.ts
 * defines them (above = the resume's level exceeds the role's)?
 *
 * ANSWER, pinned here: it does not read the alignment AT ALL. The tier comes from the stored score and the screenable-tag total
 * (`describeMatchConfidence`); seniority reaches the tier only through the stored score, where score.ts applies a SYMMETRIC adjustment (it uses
 * the absolute difference between the two levels: +5 for a match, 0 for one level apart, -15 for two or more, in either direction). So there is
 * no direction for the tier maths to get wrong, and no scoring bug. This is a characterization: it passes on today's code, and fails if the tier
 * ever starts depending on the alignment value or the scorer's adjustment stops being symmetric.
 */
import { describe, expect, it } from "vitest";
import { effectiveTierFor } from "@/lib/employer/applicant-filters";
import { computeMatchScore, type MatchExplanation } from "@/lib/matching/score";

const resume = (title: string) =>
  ({ contact: {}, experience: [{ title, company: "Co", startDate: "2020", endDate: "2024", description: "" }], education: [], skills: ["sql", "python"], projects: [], certifications: [] }) as never;
const SKILLS = ["sql", "python", "aws", "docker"];
const ALIGNMENTS: Array<MatchExplanation["seniorityAlignment"]> = ["match", "above", "below", "unknown"];

describe("a Senior resume against an Entry job, and the reverse", () => {
  const seniorVsEntry = computeMatchScore(resume("Senior Accountant"), SKILLS, "entry", undefined);
  const entryVsSenior = computeMatchScore(resume("Graduate Trainee"), SKILLS, "senior", undefined);

  it("the scorer labels them the way score.ts defines it: above = the resume's level exceeds the role's", () => {
    expect(seniorVsEntry.explanation.seniorityAlignment).toBe("above");
    expect(entryVsSenior.explanation.seniorityAlignment).toBe("below");
  });

  it("the adjustment is symmetric: both directions score the same here (2 of 4 tags = 50, minus 15 for two levels apart = 35)", () => {
    expect(seniorVsEntry.score).toBe(35);
    expect(entryVsSenior.score).toBe(35);
  });

  it("the applicants page's tier is the same whichever direction: it is the score's tier, and it does not read the alignment", () => {
    expect(effectiveTierFor(seniorVsEntry.score, seniorVsEntry.explanation)).toBe(effectiveTierFor(entryVsSenior.score, entryVsSenior.explanation));
  });

  for (const [name, r] of [
    ["Senior resume vs Entry job", seniorVsEntry],
    ["Entry resume vs Senior job", entryVsSenior],
  ] as const) {
    it(`${name}: the tier is identical for every alignment value (it is never read)`, () => {
      const tiers = ALIGNMENTS.map((a) => effectiveTierFor(r.score, { ...r.explanation, seniorityAlignment: a }));
      expect(new Set(tiers).size).toBe(1);
    });
  }

  it("a high score gets its tier whatever the alignment, in both directions (Excellent stays Excellent)", () => {
    for (const a of ALIGNMENTS) {
      expect(effectiveTierFor(95, { matchedSkills: ["a", "b", "c", "d"], missingSkills: [], seniorityAlignment: a })).toBe("excellent");
      expect(effectiveTierFor(65, { matchedSkills: ["a", "b", "c", "d"], missingSkills: [], seniorityAlignment: a })).toBe("fair");
    }
  });
});
