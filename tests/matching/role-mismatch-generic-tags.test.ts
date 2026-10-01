/**
 * send-492 (diagnosis, tests first) — a Product Manager resume must not score as a strong match for a QA
 * Engineer, an IT Administrator or a Marketing Manager.
 *
 * WHAT PRODUCTION SHOWED (owner's /auto-apply, 2026-10-01): "99% · Excellent" for exactly these roles. The
 * mechanism, reproduced here with the repo's own functions: a job's `structured_jd.skills` holds only the
 * canonical vocabulary terms the posting text happened to contain (`sql`, `azure`, `agile`, `project management`),
 * and `NON_SCREENABLE_SKILLS` removes `communication` / `leadership` / `operations`. What is left is a handful
 * of GENERIC tools that almost any professional resume lists, so a Product Manager's "SQL", "Cloud (AWS, Azure)"
 * (expanded to `aws` + `azure`) and "SAFe Agile" (expanded to `agile`) cover 100% of a QA Engineer's screenable
 * tags. `computeMatchScore` measures tag coverage and nothing about the ROLE, so 3/3 = 100 (plus 5 for matching
 * seniority, clamped). The job's title is on the row and never reaches the scorer: `scoreJobs` passes only
 * `structured_jd.skills` and `seniority`.
 *
 * THE FIXTURES ARE FACTS, NOT PROSE: titles, canonical tag lists and seniorities exactly as stored on the
 * production job rows, plus a FICTIONAL Product Manager resume whose skill entries are of the same kind as the
 * owner's (no real person's resume is committed to this public repo, and no third-party job-description text).
 *
 * RED ON CURRENT CODE for the three roles below. The controls are GREEN now and must stay green after any fix,
 * so a "fix" that simply scores everything low cannot pass.
 */
import { describe, expect, it } from "vitest";
import { scoreJobs } from "@/lib/matching/compute-and-store";
import type { StructuredResume } from "@/lib/resume/types";

type JobPosting = Parameters<typeof scoreJobs>[1][number];

const PM_RESUME = {
  contact: { name: "Ada Okafor", email: "ada@example.test", location: "Lagos, Nigeria" },
  summary: "Product manager building payment products.",
  experience: [
    { title: "Product Manager", company: "Example Payments", location: "Lagos", startDate: "2022", endDate: "2026", description: "Owned the roadmap for a merchant payments product." },
    { title: "Associate Product Manager", company: "Example Bank", location: "Lagos", startDate: "2019", endDate: "2022", description: "Backlog prioritisation and delivery." },
  ],
  education: [],
  skills: [
    "Project Management", "Product development", "SAFe Agile", "Product Marketing", "Product (UI/ UX) Design",
    "Software Development", "APIs", "Cloud (AWS, Azure)", "SQL", "Analytics (Pendo)", "System Design", "CI/CD",
    "Scrum", "Backlog Prioritization", "UX/UI Design",
  ],
  projects: [],
  certifications: [],
} as unknown as StructuredResume;

function job(id: string, title: string, skills: string[], seniority: string): JobPosting {
  return { id, title, seniority, structured_jd: { skills, keywords: skills, responsibilities: [] } } as unknown as JobPosting;
}

/** The roles the owner's queue showed at 99% Excellent, with their stored tags. */
const MISMATCHED_ROLES: Array<[string, JobPosting]> = [
  ["QA Engineer (Manual & Automation) - Cape Town", job("qa", "QA Engineer (Manual & Automation) - Cape Town", ["sql", "azure", "agile", "communication"], "mid")],
  ["IT Administrator", job("itadmin", "IT Administrator", ["azure", "operations", "communication"], "mid")],
  ["Marketing Manager", job("marketing", "Marketing Manager", ["project management", "leadership", "communication"], "mid")],
];

describe("a Product Manager resume against roles that are not Product Management", () => {
  for (const [name, j] of MISMATCHED_ROLES) {
    it(`${name}: stays below 60`, () => {
      const [scored] = scoreJobs(PM_RESUME, [j]);
      expect(scored.score, `${name} scored ${scored.score} (${scored.tier}) on tags ${JSON.stringify(scored.explanation.matchedSkills)}`).toBeLessThan(60);
    });
  }
});

describe("controls: a fix must not just score everything low", () => {
  it("a Product Manager role with the same kind of tags still scores well (>= 70)", () => {
    const [scored] = scoreJobs(PM_RESUME, [job("pm", "Senior Product Manager", ["project management", "agile", "scrum", "sql", "aws"], "mid")]);
    expect(scored.score).toBeGreaterThanOrEqual(70);
  });

  it("a role with no overlap at all still scores low (the scorer is not simply inflated everywhere)", () => {
    const [scored] = scoreJobs(PM_RESUME, [job("far", "Staff Software Engineer (Back-End)", ["node.js", "java"], "senior")]);
    expect(scored.score).toBeLessThan(40);
  });
});
