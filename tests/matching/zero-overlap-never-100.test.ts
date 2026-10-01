/**
 * send-492 — a job with zero overlapping tags can never score 100.
 *
 * A regression pin, GREEN on current code: with no matched screenable tag the coverage term is 0, so the best
 * possible score is 0 + the +5 seniority bonus. The sweep below runs every shape of "nothing in common"
 * (a non-empty screenable tag set with no overlap, at every seniority pairing) so a future change to coverage,
 * the neutral 50 for an empty tag set, or the seniority adjustment cannot quietly make a total mismatch look
 * perfect. It also pins the two neighbouring cases that are NOT zero overlap and are where 100 really comes
 * from today (every screenable tag matched), so the sweep is not vacuous.
 */
import { describe, expect, it } from "vitest";
import { computeMatchScore } from "@/lib/matching/score";
import type { StructuredResume } from "@/lib/resume/types";
import type { SeniorityLevel } from "@/lib/jobs/types";

const RESUME = {
  contact: {}, summary: "", education: [], projects: [], certifications: [],
  experience: [{ title: "Product Manager", company: "x", location: "", startDate: "", endDate: "", description: "" }],
  skills: ["Project Management", "SQL", "SAFe Agile", "Cloud (AWS, Azure)", "Scrum"],
} as unknown as StructuredResume;

const SENIORITIES: Array<SeniorityLevel | undefined> = [undefined, "entry", "mid", "senior", "lead", "executive"];
const NO_OVERLAP_TAG_SETS = [["java"], ["python", "kubernetes"], ["figma", "react", "stata"], ["crm", "hr", "logistics", "compliance"]];

describe("zero overlapping screenable tags", () => {
  for (const tags of NO_OVERLAP_TAG_SETS) {
    for (const seniority of SENIORITIES) {
      it(`${JSON.stringify(tags)} at ${seniority ?? "unknown"} seniority never scores 100 (and never reaches Excellent)`, () => {
        const { score, explanation } = computeMatchScore(RESUME, tags, seniority);
        expect(explanation.matchedSkills).toEqual([]);
        expect(score).toBeLessThanOrEqual(5);
        expect(score).toBeLessThan(80);
      });
    }
  }

  it("controls: every screenable tag matched is the ONLY route to 100 (so the sweep above is meaningful)", () => {
    expect(computeMatchScore(RESUME, ["sql"], "mid").score).toBe(100);
    expect(computeMatchScore(RESUME, ["sql", "project management"], "mid").score).toBe(100);
    // ...and the posting with NO screenable tags is the neutral case, never 100.
    expect(computeMatchScore(RESUME, ["communication", "leadership", "operations"], "mid").score).toBeLessThan(60);
  });
});
