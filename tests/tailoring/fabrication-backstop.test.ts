/**
 * End-to-end sabotage-proof test, through the REAL entry point.
 *
 * tests/tailoring/grounding.test.ts already proves the backstop module
 * itself strips fabricated content when called directly. This proves it's
 * actually WIRED IN to tailorResumeToJob — the function every real caller
 * (the /api/tailoring route, the anonymous JD demo) goes through — not just
 * that the helper works in isolation.
 *
 * The LLM is mocked to return exactly the real incident's fabricated JSON
 * (2026-09-06: a PM resume, a Global MEL Manager posting, Stata/R/Survey
 * Design/Statistical Analysis added, "performance reviews" and "capacity
 * planning" invented into an experience bullet) — this is what a genuinely
 * fabricating model response looks like, not a synthesized worst case.
 * Mocked rather than a real API call for the same reason
 * jd-truncation.test.ts's LLM is stubbed: this is about a contract that must
 * hold regardless of model behaviour, and it must run in CI without
 * spending API budget or depending on a provider being reachable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.fn();

vi.mock("@/lib/llm", () => ({
  getLLMProvider: () => ({ name: "test", model: "test", generateText, generateWithUsage: vi.fn() }),
}));

const { tailorResumeToJob } = await import("@/lib/tailoring/tailor");
const { EMPTY_RESUME } = await import("@/lib/resume/types");

const BASE_RESUME = {
  ...EMPTY_RESUME,
  contact: { name: "Quazim Akinwande" },
  skills: [
    "Project Management",
    "Product development",
    "SAFe Agile",
    "APIs",
    "Cloud (AWS, Azure)",
    "SQL",
  ],
  experience: [
    {
      title: "Senior Product Manager",
      company: "Bankly",
      description: "Owned the roadmap for a savings product used by thousands of customers.",
    },
  ],
};

/** The real fabricated response from the 2026-09-06 incident, reproduced exactly. */
function fabricatingLlmResponse() {
  return JSON.stringify({
    structuredJd: {
      skills: ["Stata", "R", "Survey Design", "Statistical Analysis"],
      keywords: ["capacity planning", "quasi-experimental design"],
      responsibilities: ["owning their goal-setting, performance reviews, development", "team-level project and capacity planning"],
    },
    gapAnalysis: [{ keyword: "Stata", status: "missing" }],
    tailoredResume: {
      contact: { name: "Quazim Akinwande" },
      experience: [
        {
          title: "Senior Product Manager",
          company: "Bankly",
          description:
            "Standardized integrations across multiple country teams. Managed cross-functional squads, conducting regular performance reviews and capacity planning.",
        },
      ],
      education: [],
      skills: ["Process Design", "Survey Design", "Statistical Analysis", "Stata", "R"],
      projects: [],
      certifications: [],
    },
    atsScore: 68,
    atsFixes: ["add 'Stata' — appears 1x in this JD, 0x in your resume"],
    proposedAdditions: [], // A model under score-pressure has no incentive to self-report here either.
  });
}

beforeEach(() => {
  generateText.mockReset();
  generateText.mockResolvedValue(fabricatingLlmResponse());
});

describe("tailorResumeToJob never returns fabricated content in tailoredResume", () => {
  it("strips every fabricated skill even though the model inlined them directly", async () => {
    const result = await tailorResumeToJob(BASE_RESUME, "A Global MEL Manager posting requiring Stata and R.", false);

    for (const fabricated of ["Stata", "R", "Survey Design", "Statistical Analysis"]) {
      expect(result.tailoredResume.skills).not.toContain(fabricated);
    }
  });

  it("reverts the experience entry that lifted JD phrases, even though the model inlined them directly", async () => {
    const result = await tailorResumeToJob(BASE_RESUME, "A Global MEL Manager posting.", false);

    const description = result.tailoredResume.experience[0]?.description ?? "";
    for (const phrase of ["performance reviews", "capacity planning", "multiple country teams"]) {
      expect(description.toLowerCase()).not.toContain(phrase);
    }
    // Reverted to the candidate's own real text, not left blank.
    expect(description).toBe(BASE_RESUME.experience[0].description);
  });

  it("surfaces the stripped content as proposedAdditions instead of just discarding it", async () => {
    const result = await tailorResumeToJob(BASE_RESUME, "A Global MEL Manager posting.", false);

    expect(result.proposedAdditions.length).toBeGreaterThan(0);
    expect(result.proposedAdditions.some((a) => a.section === "skills" && a.text === "Stata")).toBe(true);
    expect(result.proposedAdditions.some((a) => a.section === "experience")).toBe(true);
  });

  it("a genuinely grounded rewrite is left alone — this isn't a blanket strip", async () => {
    generateText.mockResolvedValue(
      JSON.stringify({
        structuredJd: { skills: [], keywords: [], responsibilities: [] },
        gapAnalysis: [],
        tailoredResume: {
          contact: { name: "Quazim Akinwande" },
          experience: [
            {
              title: "Senior Product Manager",
              company: "Bankly",
              description: "Led the roadmap for a savings product serving thousands of customers.",
            },
          ],
          education: [],
          skills: ["Project Management", "SQL"],
          projects: [],
          certifications: [],
        },
        atsScore: 80,
        atsFixes: [],
        proposedAdditions: [],
      }),
    );

    const result = await tailorResumeToJob(BASE_RESUME, "Any JD.", false);
    expect(result.tailoredResume.experience[0].description).toContain("Led the roadmap");
    expect(result.tailoredResume.skills).toEqual(["Project Management", "SQL"]);
    expect(result.proposedAdditions).toEqual([]);
  });
});
