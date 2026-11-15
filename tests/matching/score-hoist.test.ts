/**
 * FEED-PERF-2 F0: the resume's skills are expanded ONCE per resume per run of jobs, not once per job, and nothing about any score changes.
 *  - call count: scoreJobs and the refresh loop call the expansion once per resume (vi.spyOn on the module's export; no module factory); the other two loops are pinned by reading their source;
 *  - two resumes: alternating resumes never leak into each other, and a prepared set built from one resume is ignored for another;
 *  - the golden (tests/matching/score-golden.test.ts) re-run through the hoisted paths gives the same result;
 *  - the prepared value is a ReadonlySet, created inside the call and never stored at module or request level.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as resumeSkills from "@/lib/matching/resume-skills";
import * as normalize from "@/lib/courses/normalize";
import { computeMatchScore } from "@/lib/matching/score";
import { scoreJobs } from "@/lib/matching/compute-and-store";
import { refreshUsers } from "@/lib/matching/refresh-users";
import { GOLDEN_JOBS, GOLDEN_RESUMES } from "./support/score-golden-inputs";
import { compute } from "./score-golden.test";
import type { StructuredResume } from "@/lib/resume/types";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
afterEach(() => vi.restoreAllMocks());

const jobs = GOLDEN_JOBS.map((j) => ({ id: j.id, title: j.title as string, seniority: j.seniority ?? null, posted_at: "2026-11-01T00:00:00Z", structured_jd: { skills: j.skills } }));
const A = GOLDEN_RESUMES[0].resume;
const B = GOLDEN_RESUMES[4].resume;

/**
 * An expansion is counted at its one cross-module call, normalizeSkillKeyword (a spy on expandResumeSkills itself would miss prepareResumeSkills calling it inside its own module).
 * perExpansion = how many normalizer calls ONE expansion of resume A makes; N expansions must make exactly N times that.
 */
function perExpansion(resume: StructuredResume): number {
  const spy = vi.spyOn(normalize, "normalizeSkillKeyword");
  resumeSkills.expandResumeSkills(resume.skills);
  const n = spy.mock.calls.length;
  spy.mockRestore();
  return n;
}

describe("call count: one expansion per resume per window", () => {
  it("scoreJobs over 50 jobs expands once", () => {
    const per = perExpansion(A);
    expect(per).toBeGreaterThan(0);
    const spy = vi.spyOn(normalize, "normalizeSkillKeyword");
    scoreJobs(A, jobs as never);
    expect(spy.mock.calls.length).toBe(per);
  });

  it("without a prepared set, today's behaviour: one expansion per job (what the hoist replaces)", () => {
    const per = perExpansion(A);
    const spy = vi.spyOn(normalize, "normalizeSkillKeyword");
    for (const j of GOLDEN_JOBS.slice(0, 5)) computeMatchScore(A, j.skills, j.seniority, j.title);
    expect(spy.mock.calls.length).toBe(per * 5);
  });

  it("the refresh loop expands once per user (3 users, 50 postings each), not once per posting", async () => {
    const per = perExpansion(A);
    const spy = vi.spyOn(normalize, "normalizeSkillKeyword");
    const eligible = jobs.map((j) => ({ id: j.id, title: j.title, structuredJd: j.structured_jd, seniority: null, organizationId: null }));
    const out = await refreshUsers(
      { scoredPostingIds: async () => new Set<string>(), loadBaseResume: async () => A, persist: async (_u: string, s: unknown[]) => ({ persisted: s.length, ok: true }) } as never,
      eligible as never,
      ["u1", "u2", "u3"],
    );
    expect(out.usersRefreshed).toBe(3);
    expect(spy.mock.calls.length).toBe(per * 3);
  });

  it("the rescore loop and the proactive alert loop prepare once, outside their per-job map, and hand it to the scorer", () => {
    const rescore = strip(read("src/lib/matching/rescore-stale.ts"));
    expect(rescore).toMatch(/const prepared = prepareResumeSkills\(resume\);[^\n]*\n\s*const scored = scorable\.map\(\(row\) => \(\{ row, next: scoreRow\(resume, open\.get\(row\.jobId\)!, prepared\) \}\)\);/);
    const alert = strip(read("src/lib/notifications/proactive-match-alert/send.ts"));
    expect(alert).toMatch(/const prepared = prepareResumeSkills\(resume\);[^\n]*\n\s*const scored: ScoredNewJob\[\] = newPostings\.map/);
    expect(alert).toContain("p.title, prepared)");
  });
});

describe("two resumes never share an entry", () => {
  it("alternating A and B window by window gives each its own golden result", () => {
    const g = compute();
    for (let round = 0; round < 3; round += 1) {
      for (const r of [GOLDEN_RESUMES[0], GOLDEN_RESUMES[4]]) {
        const got = scoreJobs(r.resume, GOLDEN_JOBS.map((j) => ({ id: j.id, title: j.title as string, seniority: j.seniority ?? null, posted_at: "x", structured_jd: { skills: j.skills } })) as never);
        expect(JSON.parse(JSON.stringify(got.map((s) => ({ score: s.score, explanation: s.explanation }))))).toEqual(g[r.name]);
      }
    }
  });

  it("alternating windows each expand exactly once for their own resume (A then B then A: three expansions, never fewer, never per job)", () => {
    const perA = perExpansion(A);
    const perB = perExpansion(B);
    const spy = vi.spyOn(normalize, "normalizeSkillKeyword");
    scoreJobs(A, jobs as never);
    scoreJobs(B, jobs as never);
    scoreJobs(A, jobs as never);
    expect(spy.mock.calls.length).toBe(perA + perB + perA);
  });

  it("a prepared set built from resume A is ignored when scoring resume B", () => {
    const fromA = resumeSkills.prepareResumeSkills(A);
    for (const j of GOLDEN_JOBS) {
      const wrong = computeMatchScore(B, j.skills, j.seniority, j.title, fromA);
      const right = computeMatchScore(B, j.skills, j.seniority, j.title);
      expect(wrong).toEqual(right);
    }
  });

  it("a prepared set built from the same resume gives the same result as none", () => {
    for (const { resume } of GOLDEN_RESUMES) {
      const prepared = resumeSkills.prepareResumeSkills(resume);
      for (const j of GOLDEN_JOBS) expect(computeMatchScore(resume, j.skills, j.seniority, j.title, prepared)).toEqual(computeMatchScore(resume, j.skills, j.seniority, j.title));
    }
  });
});

describe("the golden through the hoisted paths", () => {
  it("scoreJobs reproduces the golden scores and explanations for every resume", () => {
    const g = compute();
    for (const { name, resume } of GOLDEN_RESUMES) {
      const got = scoreJobs(resume, GOLDEN_JOBS.map((j) => ({ id: j.id, title: j.title as string, seniority: j.seniority ?? null, posted_at: "x", structured_jd: { skills: j.skills } })) as never);
      expect(JSON.parse(JSON.stringify(got.map((s) => ({ score: s.score, explanation: s.explanation }))))).toEqual(g[name]);
    }
  });
});

describe("the prepared value is read-only and never stored", () => {
  it("prepareResumeSkills returns the set typed ReadonlySet and the source array it was built from", () => {
    const r = { skills: ["Python"] } as unknown as StructuredResume;
    const p = resumeSkills.prepareResumeSkills(r);
    expect(p.source).toBe(r.skills);
    expect(p.skills.has("python")).toBe(true);
  });

  it("no module-level or request-level storage: prepareResumeSkills is only ever called inside a function body, in the loops' own scope", () => {
    for (const rel of ["src/lib/matching/compute-and-store.ts", "src/lib/matching/refresh-users.ts", "src/lib/matching/rescore-stale.ts", "src/lib/notifications/proactive-match-alert/send.ts"]) {
      const src = strip(read(rel));
      for (const m of src.matchAll(/prepareResumeSkills\(/g)) {
        const before = src.slice(0, m.index);
        const line = before.slice(before.lastIndexOf("\n") + 1);
        expect(line, rel).toMatch(/^\s+(const|let)\s+prepared/); // indented: inside a function
      }
    }
    const score = strip(read("src/lib/matching/resume-skills.ts"));
    expect(score).not.toMatch(/new (Map|WeakMap)\(/);
  });
});
