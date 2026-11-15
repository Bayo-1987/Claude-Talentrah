/**
 * FEED-PERF-2 F0: GOLDEN test of computeMatchScore. 10 resumes x 50 jobs, the whole result (score AND explanation) compared exactly with a fixture generated from the code as it was before the
 * hoist (tests/matching/fixtures/score-golden.json). It was written and green on the unchanged code first; the hoist must keep it green, which is what "no behaviour change" means here.
 * The fixture is also pinned by its own hash, so it cannot be regenerated quietly to make a change pass.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeMatchScore } from "@/lib/matching/score";
import { GOLDEN_JOBS, GOLDEN_RESUMES } from "./support/score-golden-inputs";

const FIXTURE = path.resolve(__dirname, "fixtures/score-golden.json");
const golden = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown[]>;

export const compute = () =>
  Object.fromEntries(
    GOLDEN_RESUMES.map((r) => [r.name, GOLDEN_JOBS.map((j) => JSON.parse(JSON.stringify(computeMatchScore(r.resume, j.skills, j.seniority, j.title))))]),
  );

describe("computeMatchScore golden", () => {
  it("the fixture covers every resume and job (10 x 50) and was not regenerated: its hash is pinned", () => {
    expect(Object.keys(golden)).toEqual(GOLDEN_RESUMES.map((r) => r.name));
    for (const rows of Object.values(golden)) expect(rows).toHaveLength(GOLDEN_JOBS.length);
    expect(createHash("sha256").update(readFileSync(FIXTURE)).digest("hex")).toBe("43cddfdae8c986e64f5728ea8cfe030d2342b37dff83b63dd5f4bba8d8718448");
  });

  it("every score and every explanation equals the fixture exactly", () => {
    expect(compute()).toEqual(golden);
  });

  it("the inputs include the shapes that matter (empty, null, missing, duplicate and mixed-case skills; jobs with no skills)", () => {
    const names = GOLDEN_RESUMES.map((r) => r.name);
    for (const n of ["empty skills", "skills null", "skills key missing", "duplicate and mixed-case skills"]) expect(names).toContain(n);
    expect(GOLDEN_JOBS.some((j) => j.skills.length === 0)).toBe(true);
    expect(GOLDEN_JOBS.some((j) => j.title === undefined)).toBe(true);
  });
});
