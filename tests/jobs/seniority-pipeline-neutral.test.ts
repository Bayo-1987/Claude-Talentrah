/**
 * S12 (e) — the END-TO-END half of the neutrality guarantee: a posting whose title is silent about level is extracted as
 * unknown, and the scorer then treats it exactly as S3's pin says (tests/matching/scorer-seniority-unknown-neutral.test.ts):
 * the score is the skill coverage alone, whatever the candidate's level.
 *
 * S3's file pins the SCORER given `undefined`. This pins the PIPELINE that produces the `undefined`: `inferJobSeniority` (this
 * change) -> `computeMatchScore`. Together they say that the 412 postings that stop being recorded as `mid` score at their
 * skill coverage and do not drift, and that nothing quietly defaults them back to a level on the way.
 *
 * The numbers are S3's: 2 of 4 screenable tags matched = coverage 50; a known level adds +5 (same), 0 (adjacent), -15 (two or
 * more apart). The "before" column is what the old default produced (`inferSeniority` -> "mid"): +5 for a mid candidate, -15
 * for an executive, i.e. a posting's score moved with a level nobody had stated.
 */
import { describe, expect, it } from "vitest";
import { inferJobSeniority, inferSeniority } from "@/lib/jobs/extract-jd";
import { computeMatchScore } from "@/lib/matching/score";
import type { StructuredResume } from "@/lib/resume/types";

const resume = (title: string): StructuredResume =>
  ({
    contact: { name: "Ada Okafor", email: "ada@example.test" },
    summary: "",
    experience: [{ title, company: "Example Co", startDate: "2022", endDate: "2026", description: "x" }],
    education: [],
    skills: ["sql", "python"],
    projects: [],
    certifications: [],
  }) as StructuredResume;

const JOB_TAGS = ["sql", "python", "kubernetes", "terraform"]; // 2 of 4 matched: coverage 50
const COVERAGE_ONLY = 50;
const CANDIDATES = ["Intern", "Accountant", "Senior Engineer", "Head of Finance", "Chief Financial Officer"];

// real titles from the 2026-10-01 audit that carried no level word (412 of 662 open postings were recorded as "mid" for this)
const SILENT_TITLES = [
  "Finance Associate",
  "Customer Success Associate",
  "Engineering Manager",
  "Business Relationship Manager (Imo)",
  "Product Manager, Customer Support",
  "Field Credit Officer (Osun)",
  "Data Scientist",
  "Software Engineer",
  "Executive Assistant",
];

/** A NULL `job_postings.seniority` column read back is `null`; the scorer takes `undefined`. */
const readBack = (v: Parameters<typeof computeMatchScore>[2] | null) => v ?? undefined;

describe("a silent title is extracted as unknown and scored at its skill coverage, for every candidate", () => {
  it.each(SILENT_TITLES)("%s", (title) => {
    const seniority = inferJobSeniority(title);
    expect(seniority, "the extraction must not invent a level").toBeUndefined();
    for (const candidate of CANDIDATES) {
      const r = computeMatchScore(resume(candidate), JOB_TAGS, seniority);
      expect(r.score, `${title} vs ${candidate}`).toBe(COVERAGE_ONLY);
      expect(r.explanation.seniorityAlignment).toBe("unknown");
    }
  });

  it("the same posting scores the same whether the field is absent or explicitly undefined (a NULL column read back as null)", () => {
    for (const title of SILENT_TITLES) {
      const a = computeMatchScore(resume("Accountant"), JOB_TAGS, inferJobSeniority(title)).score;
      const b = computeMatchScore(resume("Accountant"), JOB_TAGS, readBack(null)).score;
      expect(a).toBe(b);
    }
  });
});

describe("what the old default did, so the change is visible rather than assumed", () => {
  it("the resume-side default still reads these titles as mid, which would have moved the score with a level nobody stated", () => {
    for (const title of SILENT_TITLES.filter((t) => t !== "Executive Assistant")) expect(inferSeniority(title)).toBe("mid");
    const before = computeMatchScore(resume("Accountant"), JOB_TAGS, inferSeniority("Finance Associate")).score;
    const after = computeMatchScore(resume("Accountant"), JOB_TAGS, inferJobSeniority("Finance Associate")).score;
    expect(before).toBe(55); // a mid candidate against a "mid" the source never said
    expect(after).toBe(COVERAGE_ONLY);
  });
});

describe("a level the title DOES state still moves the score, so none of the above is a no-op test", () => {
  it("senior stated -> adjacent to a mid candidate (0); executive stated -> two apart (-15)", () => {
    expect(computeMatchScore(resume("Accountant"), JOB_TAGS, inferJobSeniority("Senior Data Analyst")).score).toBe(COVERAGE_ONLY);
    expect(computeMatchScore(resume("Accountant"), JOB_TAGS, inferJobSeniority("Marketing Director")).score).toBe(COVERAGE_ONLY - 15);
    expect(computeMatchScore(resume("Accountant"), JOB_TAGS, "mid").score).toBe(COVERAGE_ONLY + 5);
  });
});
