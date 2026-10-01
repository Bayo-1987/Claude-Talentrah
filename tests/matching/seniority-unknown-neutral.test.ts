/**
 * S12 (e) / S3 — the scorer treats an UNKNOWN job seniority as neutral: no penalty, no boost, and no dependence on who is
 * being scored.
 *
 * Why this lives here: S12 stops recording a guessed "mid" for postings whose title is silent (412 of 662 on the live
 * board), so those rows' seniority becomes NULL and `computeMatchScore` is called with `undefined`. If the scorer
 * mishandled that, 412 postings would change score at once. This pins the contract the change relies on, from the
 * scorer's side, WITHOUT touching src/lib/matching/score.ts (S3 owns it).
 *
 * Neutral means: the score is exactly the skill coverage; seniorityAlignment is "unknown"; and the same job scores the same
 * for a graduate and for a director.
 */
import { describe, expect, it } from "vitest";
import { computeMatchScore } from "@/lib/matching/score";
import type { StructuredResume } from "@/lib/resume/types";

const resumeWith = (title: string, skills: string[]): StructuredResume =>
  ({
    contact: { name: "Test Candidate", email: "t@example.com" },
    summary: "",
    experience: [{ title, company: "Acme", startDate: "2020-01", endDate: "2024-01", bullets: [] }],
    education: [],
    skills,
    certifications: [],
  }) as unknown as StructuredResume;

const JOB_SKILLS = ["python", "sql", "excel", "tableau"];

describe("an unknown job seniority is neutral", () => {
  const titles = ["Intern", "Accountant", "Senior Engineer", "Head of Finance", "Chief Financial Officer"];

  it("changes the score by exactly zero, whatever the candidate's level", () => {
    const base = Math.round((2 / 4) * 100); // two of four screenable skills matched
    for (const title of titles) {
      const r = computeMatchScore(resumeWith(title, ["python", "sql"]), JOB_SKILLS, undefined);
      expect(r.score, title).toBe(base);
      expect(r.explanation.seniorityAlignment, title).toBe("unknown");
    }
  });

  it("a KNOWN seniority still moves it, so the neutral case above is not a no-op test", () => {
    const resume = resumeWith("Accountant", ["python", "sql"]);
    const unknown = computeMatchScore(resume, JOB_SKILLS, undefined).score;
    const match = computeMatchScore(resume, JOB_SKILLS, "mid").score;
    const far = computeMatchScore(resume, JOB_SKILLS, "executive").score;
    expect(match).toBe(unknown + 5);
    expect(far).toBe(unknown - 15);
  });

  it("an unknown resume title is neutral too (the other half of the same branch)", () => {
    const r = computeMatchScore({ ...resumeWith("", ["python", "sql"]), experience: [] } as StructuredResume, JOB_SKILLS, "senior");
    expect(r.explanation.seniorityAlignment).toBe("unknown");
    expect(r.score).toBe(50);
  });
});
