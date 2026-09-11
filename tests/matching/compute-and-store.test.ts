/**
 * scoreJobs (src/lib/matching/compute-and-store.ts) — the exact call every
 * signed-in user's /jobs feed makes directly, with no try/catch around it.
 * Confirms the resume-skills.ts / score.ts fix (a resume missing `skills`/
 * `experience` must score, never throw) actually reaches this call site,
 * not just the underlying computeMatchScore primitive in isolation.
 *
 * Before that fix, a real ambient resume with no `skills` key on
 * structured_content at all (docs/jobs-feed-pagination.md) crashed here —
 * inside a bare `.map()` with nothing catching it — which meant that
 * user's ENTIRE feed page failed to render, not just one card's score.
 */
import { describe, expect, it } from "vitest";
import { scoreJobs } from "@/lib/matching/compute-and-store";
import type { StructuredResume } from "@/lib/resume/types";

function jobWith(id: string, skills: string[]) {
  return {
    id,
    structured_jd: { skills },
    // No seniority on the job side — these tests are isolating the skills
    // fix, and a resume that DOES carry experience would otherwise pick up
    // a seniority-match bonus on top of the skill score, which is a
    // separate mechanism already covered by match-score.test.ts.
    seniority: null,
  } as unknown as Parameters<typeof scoreJobs>[1][number];
}

describe("scoreJobs: the feed's own direct call site", () => {
  it("a resume with no skills field at all does not crash the whole batch", () => {
    const resume = { experience: [] } as unknown as StructuredResume;
    const jobs = [jobWith("job-1", ["sql"]), jobWith("job-2", ["figma"])];

    expect(() => scoreJobs(resume, jobs)).not.toThrow();
    const scored = scoreJobs(resume, jobs);
    expect(scored).toHaveLength(2);
    expect(scored[0].score).toBe(0);
    expect(scored[0].explanation.missingSkills).toEqual(["sql"]);
  });

  it("a resume with no experience field at all does not crash the whole batch", () => {
    const resume = { skills: ["sql"] } as unknown as StructuredResume;
    const jobs = [jobWith("job-1", ["sql"])];

    expect(() => scoreJobs(resume, jobs)).not.toThrow();
    const scored = scoreJobs(resume, jobs);
    expect(scored[0].explanation.seniorityAlignment).toBe("unknown");
    expect(scored[0].explanation.matchedSkills).toEqual(["sql"]);
  });
});
