/**
 * A2 — the role-family check inside the scorer. computeMatchScore takes the job's TITLE as an optional fourth argument:
 *   - both titles classify and nothing is the same or adjacent: the score caps at 59 (explanation.roleFit "different");
 *   - the job or the resume is unclassified: the score keeps its value up to Good (79) and can never reach Auto-Apply (roleFit "unknown");
 *   - same or adjacent: untouched;
 *   - baseline tags (project management, agile, scrum, stakeholder management, microsoft office, excel) count in the denominator only for
 *     the families they are core for.
 * Without a title (the old three-argument call) nothing changes.
 *
 * The reported case: a Product Manager resume scored "99% Excellent" against a Global MEL Manager posting whose ONLY screenable tag was
 * "project management".
 */
import { describe, expect, it } from "vitest";
import { computeMatchScore } from "@/lib/matching/score";
import type { MatchResult } from "@/lib/matching/score";
import type { SeniorityLevel } from "@/lib/jobs/types";
import type { StructuredResume } from "@/lib/resume/types";

type Score4 = (r: StructuredResume, skills: string[], seniority: SeniorityLevel | undefined, jobTitle?: string) => MatchResult & {
  explanation: MatchResult["explanation"] & { roleFit?: string; scoreBeforeRoleFit?: number };
};
const score = computeMatchScore as unknown as Score4;

const resume = (titles: string[], skills: string[]): StructuredResume =>
  ({
    contact: {},
    experience: titles.map((title) => ({ title, company: "Co", startDate: "2020", endDate: "2024", description: "" })),
    education: [],
    skills,
    projects: [],
    certifications: [],
  }) as unknown as StructuredResume;

const PM = resume(["Product Manager"], ["sql", "python", "project management", "agile", "stakeholder management"]);

describe("different family: capped at 59", () => {
  it("THE REPORTED CASE: a product manager resume against a Global MEL Manager whose only tag is project management", () => {
    const r = score(PM, ["project management"], undefined, "Global MEL Manager/Senior Manager");
    expect(r.explanation.roleFit).toBe("different");
    expect(r.score).toBeLessThanOrEqual(59);
    // the baseline tag does not count for a research/NGO role: nothing screenable was measured
    expect(r.explanation.matchedSkills).toEqual([]);
    expect(r.explanation.missingSkills).toEqual([]);
  });

  it("a perfect skill match in a different family still caps at 59, and records what it would have been", () => {
    const r = score(resume(["Software Engineer"], ["sql", "python", "aws"]), ["sql", "python", "aws"], undefined, "Regional Sales Manager");
    expect(r.explanation.roleFit).toBe("different");
    expect(r.score).toBe(59);
    expect(r.explanation.scoreBeforeRoleFit).toBe(100);
  });

  it("a physical engineering role is a different family from every software family (no adjacency)", () => {
    const r = score(resume(["Software Engineer", "QA Engineer"], ["sql", "python"]), ["sql", "python"], undefined, "Mechanical Maintenance Engineer");
    expect(r.explanation.roleFit).toBe("different");
    expect(r.score).toBeLessThanOrEqual(59);
  });
});

describe("same or adjacent family: untouched", () => {
  it("same family keeps its score and says so", () => {
    const r = score(PM, ["sql", "python", "agile"], undefined, "Senior Product Manager");
    expect(r.explanation.roleFit).toBe("same");
    expect(r.score).toBe(100);
    expect(r.explanation.scoreBeforeRoleFit).toBeUndefined();
  });

  it("adjacent family keeps its score and says so (product resume, program job)", () => {
    const r = score(PM, ["agile", "scrum", "project management"], undefined, "Programme Manager");
    expect(r.explanation.roleFit).toBe("adjacent");
    expect(r.score).toBeGreaterThanOrEqual(60);
  });
});

describe("unclassified: keeps its score up to Good, never Excellent", () => {
  it("a job title that classifies as nothing caps at 79", () => {
    const r = score(PM, ["sql", "python"], undefined, "Associate Consultant");
    expect(r.explanation.roleFit).toBe("unknown");
    expect(r.score).toBe(79);
    expect(r.explanation.scoreBeforeRoleFit).toBe(100);
  });

  it("a resume with no classifiable experience caps every job at 79", () => {
    const r = score(resume([], ["sql", "python"]), ["sql", "python"], undefined, "Senior Product Manager");
    expect(r.explanation.roleFit).toBe("unknown");
    expect(r.score).toBe(79);
  });

  it("an unclassified score below the cap is left exactly as it was", () => {
    const r = score(PM, ["sql", "kubernetes", "terraform", "go"], undefined, "Associate Consultant");
    expect(r.score).toBe(25);
    expect(r.explanation.scoreBeforeRoleFit).toBeUndefined();
  });
});

describe("baseline tags are family-gated in the denominator", () => {
  it("project management counts for a program/product job and not for a marketing job", () => {
    const forProgram = score(PM, ["project management", "sql"], undefined, "Program Manager");
    expect(forProgram.explanation.matchedSkills).toContain("project management");
    const forMarketing = score(resume(["Marketing Manager"], ["project management", "sql"]), ["project management", "sql"], undefined, "Marketing Manager");
    expect(forMarketing.explanation.matchedSkills).not.toContain("project management");
    expect(forMarketing.explanation.matchedSkills).toContain("sql");
  });

  it("agile and scrum do not count for a pure engineering job", () => {
    const r = score(resume(["Software Engineer"], ["agile", "scrum", "python"]), ["agile", "scrum", "python", "aws"], undefined, "Senior Software Engineer");
    expect([...r.explanation.matchedSkills, ...r.explanation.missingSkills].sort()).toEqual(["aws", "python"]);
  });

  it("excel and microsoft office count for an operations job only", () => {
    const ops = score(resume(["Operations Manager"], ["excel"]), ["excel", "microsoft office"], undefined, "Operations Coordinator");
    expect([...ops.explanation.matchedSkills, ...ops.explanation.missingSkills].sort()).toEqual(["excel", "microsoft office"]);
    const fin = score(resume(["Product Manager"], ["excel"]), ["excel", "sql"], undefined, "Product Manager");
    expect([...fin.explanation.matchedSkills, ...fin.explanation.missingSkills]).toEqual(["sql"]);
  });
});

describe("without a title the scorer behaves exactly as before (no family check, no baseline gating)", () => {
  it("the old three-argument call is unchanged", () => {
    const r = score(PM, ["project management", "agile"], undefined);
    expect(r.explanation.roleFit).toBeUndefined();
    expect(r.explanation.matchedSkills).toEqual(["project management", "agile"]);
    expect(r.score).toBe(100);
  });
});
