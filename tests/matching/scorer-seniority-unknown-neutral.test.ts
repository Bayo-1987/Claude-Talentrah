/**
 * send-492 — the scorer treats a job whose seniority is UNKNOWN as neutral: no boost, no penalty.
 *
 * Asked for by the owner because S2's #636 changes job extraction so that a posting whose title is silent about
 * level is stored as unknown rather than defaulted to `mid`, and that is only safe if the scorer reads unknown as
 * "no information". Today's scorer already does (`computeMatchScore` adjusts only when BOTH sides have a level),
 * so this is a pin, green now, that must stay green through the matcher fix in this PR.
 *
 * Skills are chosen so coverage is exactly 50% (2 of 4), which makes every adjustment visible as a distinct number:
 *   unknown = 50 (nothing added), same level = 55 (+5), adjacent = 50 (0), two or more apart = 35 (-15).
 * A default of `mid` for the unknown case would show up as 55 for a mid resume, which is the regression guarded.
 */
import { describe, expect, it } from "vitest";
import { computeMatchScore } from "@/lib/matching/score";
import type { StructuredResume } from "@/lib/resume/types";

const resume = (title: string | undefined): StructuredResume =>
  ({
    contact: { name: "Ada Okafor", email: "ada@example.test" },
    summary: "",
    experience: title ? [{ title, company: "Example Co", startDate: "2022", endDate: "2026", description: "x" }] : [],
    education: [],
    skills: ["sql", "python"],
    projects: [],
    certifications: [],
  }) as StructuredResume;

// 2 of the job's 4 screenable tags are on the resume: 50% coverage.
const JOB_TAGS = ["sql", "python", "kubernetes", "terraform"];

describe("an unknown job seniority is neutral", () => {
  it("adds nothing and subtracts nothing: the score is the skill coverage alone", () => {
    const r = computeMatchScore(resume("Product Manager"), JOB_TAGS, undefined);
    expect(r.score).toBe(50);
    expect(r.explanation.seniorityAlignment).toBe("unknown");
  });

  it("is not the same as 'mid': a mid resume against an unknown job gets no +5", () => {
    const unknown = computeMatchScore(resume("Product Manager"), JOB_TAGS, undefined).score;
    const mid = computeMatchScore(resume("Product Manager"), JOB_TAGS, "mid").score;
    expect(mid).toBe(55);
    expect(unknown).toBeLessThan(mid);
  });

  it("is not a penalty either: it scores above a job two levels away", () => {
    const unknown = computeMatchScore(resume("Product Manager"), JOB_TAGS, undefined).score;
    const far = computeMatchScore(resume("Product Manager"), JOB_TAGS, "executive").score;
    expect(far).toBe(35);
    expect(unknown).toBeGreaterThan(far);
  });

  it("an adjacent level is also neutral, so unknown sits where 'no information' should: equal to it", () => {
    expect(computeMatchScore(resume("Product Manager"), JOB_TAGS, "senior").score).toBe(50);
  });

  it("holds when the RESUME's own level is unknown too (no work history)", () => {
    const r = computeMatchScore(resume(undefined), JOB_TAGS, undefined);
    expect(r.score).toBe(50);
    expect(r.explanation.seniorityAlignment).toBe("unknown");
  });

  it("does not change which skills are matched or missing", () => {
    const withLevel = computeMatchScore(resume("Product Manager"), JOB_TAGS, "mid").explanation;
    const unknown = computeMatchScore(resume("Product Manager"), JOB_TAGS, undefined).explanation;
    expect(unknown.matchedSkills).toEqual(withLevel.matchedSkills);
    expect(unknown.missingSkills).toEqual(withLevel.missingSkills);
  });
});
