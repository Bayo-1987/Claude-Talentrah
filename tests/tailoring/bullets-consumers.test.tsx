/**
 * Every reader of a tailored resume's experience content works with BOTH shapes:
 * the new one (`bullets: string[]`, one achievement per entry) and the old one
 * (a paragraph in `description`, or a single `bullets` string holding several
 * sentences). Resumes saved before the S2-11 tailoring change are in the second
 * shape and have to keep working.
 *
 * The consumer list this file covers (also in the PR description):
 *   1. templates + skeletons (every seeker preview and the employer's applicant
 *      view render through TemplateRenderer)             -> template-lists / old-format-resume-render, and below
 *   2. the editor's Achievements field                   -> achievements-editor.test.ts, and below
 *   3. the landing-page JD demo (getExperienceText)      -> below
 *   4. the tailoring prompt (base resume sent to the model) -> below
 *   5. the fabrication backstop's vocabulary            -> below
 *   6. accepting a proposed rewrite (accept-additions)   -> below
 *   7. scholarship eligibility + Farah personal statement prompts -> below
 *   8. Talent Directory verification grading prompt      -> below
 *   9. application resume snapshots (tracker)            -> below
 *  10. the "Start from an example" guard                 -> below
 *  11. Farah chat context + match scoring (title / skills only) -> below
 * Not readers of stored experience text: the ATS score and the cover letter are
 * produced by the same model call that tailors, from the BASE resume.
 */
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResumeExperienceEntry } from "@/lib/resume/types";

const generateText = vi.fn();
const fakeProvider = { name: "test" as const, model: "test", generateText, generateWithUsage: vi.fn() };
vi.mock("@/lib/llm", () => ({
  getLLMProvider: () => fakeProvider,
  generateWithFailover: (call: (p: typeof fakeProvider) => Promise<string>) => call(fakeProvider),
}));
vi.mock("@/lib/tailoring/cache", () => ({
  computeTailoringCacheKey: () => ({ cacheKey: "k", jdTextHash: "j", resumeContentHash: "r" }),
  getCachedTailoringResult: async () => null,
  saveTailoringResult: async () => {},
}));

const { EMPTY_RESUME, getExperienceBullets, getExperienceText } = await import("@/lib/resume/types");
const { TemplateRenderer } = await import("@/components/resume-builder/templates");
const { experienceBulletParagraphs } = await import("@/lib/resume-builder/achievements-editor");
const { tailorResumeToJob } = await import("@/lib/tailoring/tailor");
const { groundSkills, groundExperienceDescriptions } = await import("@/lib/tailoring/grounding");
const { mergeAcceptedAdditions } = await import("@/lib/tailoring/apply-additions");
const { checkEligibility } = await import("@/lib/scholarships/farah");
const { gradeResumeForVerification } = await import("@/lib/talent-directory/verification");
const { parseResumeSnapshot } = await import("@/lib/applications/resume-snapshot");
const { findUneditedExampleFields } = await import("@/lib/resume-builder/example-guard");
const { buildResumeContext } = await import("@/lib/farah/token-budget");
const { computeMatchScore } = await import("@/lib/matching/score");

const PARAGRAPH = "Led the onboarding redesign. Cut drop-off by 12%. Mentored two PMs.";
const GLUED = "• Led the onboarding redesign. • Cut drop-off by 12%. • Mentored two PMs.";
const ARRAY = ["Led the onboarding redesign.", "Cut drop-off by 12%.", "Mentored two PMs."];

/** [shape name, the experience entry in that shape] */
const SHAPES: Array<[string, ResumeExperienceEntry]> = [
  ["array", { title: "PM", company: "Acme", bullets: ARRAY }],
  ["old paragraph", { title: "PM", company: "Acme", description: PARAGRAPH }],
  ["old glued string", { title: "PM", company: "Acme", bullets: [GLUED] }],
];

const resumeWith = (entry: ResumeExperienceEntry) => ({
  ...EMPTY_RESUME,
  contact: { name: "Ada Obi" },
  skills: ["Product Management", "SQL"],
  experience: [entry],
});

beforeEach(() => generateText.mockReset());

describe.each(SHAPES)("consumers, %s shape", (_name, entry) => {
  const resume = resumeWith(entry);
  const stored = entry.bullets ? entry.bullets.join(" ") : entry.description;

  it("1 templates (seeker preview and employer view): render, with the content present", () => {
    const html = renderToStaticMarkup(createElement(TemplateRenderer, { slug: "clean-professional", resume }));
    expect(html).toContain("Led the onboarding redesign.");
    expect(html).toContain("Mentored two PMs.");
  });

  it("2 the editor's Achievements field seeds without throwing, from exactly what is stored", () => {
    const paragraphs = experienceBulletParagraphs(entry);
    expect(paragraphs.join(" ")).toBe(stored);
  });

  it("3 the JD demo preview line (getExperienceText) reads the text", () => {
    expect(getExperienceText(entry)).toBe(stored);
    // lockstep: bullets present <=> the text came from them
    expect(getExperienceBullets(entry) !== undefined).toBe(entry.bullets !== undefined);
  });

  it("4 the tailoring request sends the base resume as stored (bullets stay an array, description a string)", async () => {
    generateText.mockResolvedValue(
      JSON.stringify({
        structuredJd: { skills: [], keywords: [], responsibilities: [] },
        gapAnalysis: [],
        tailoredResume: { contact: {}, experience: [], education: [], skills: [], projects: [], certifications: [] },
        atsScore: 70,
        atsFixes: [],
      }),
    );
    await tailorResumeToJob(resume, "A product manager role with onboarding focus.", false);
    const prompt = generateText.mock.calls[0][0].turns[0].content as string;
    const sent = JSON.parse(prompt.split("base resume as JSON:\n")[1].split("\n\nHere is the job")[0]);
    expect(sent.experience[0].bullets).toEqual(entry.bullets);
    expect(sent.experience[0].description).toEqual(entry.description);
  });

  it("5 the fabrication backstop counts the stored text as the candidate's own words", () => {
    expect(groundSkills(["Mentored"], resume)).toEqual({ grounded: ["Mentored"], ungrounded: [] });
    const { violations } = groundExperienceDescriptions(
      [{ ...entry, bullets: undefined, description: "Mentored two PMs." }],
      resume,
      ["mentored two pms"],
    );
    expect(violations).toEqual([]);
  });

  it("6 accepting a rewrite replaces this role's text and keeps the resume intact", () => {
    const merged = mergeAcceptedAdditions(resume, [
      { id: "a", section: "experience", experienceIndex: 0, text: "Rewritten line one.\nRewritten line two.", reason: "", source: "model" },
    ]);
    expect(merged.experience[0].bullets).toEqual(["Rewritten line one.", "Rewritten line two."]);
    expect(merged.experience[0].title).toBe("PM");
  });

  it("7 scholarship eligibility sends the resume JSON, content intact", async () => {
    generateText.mockResolvedValue(JSON.stringify({ summary: "ok", verdict: "likely", criteria: [] }));
    await checkEligibility(
      { program_name: "Programme", provider: "Provider", degree_levels: [], funding_type: "full", funding_covers: [], field_tags: [], eligibility_nationalities: [] } as never,
      resume,
      "NG",
    ).catch(() => undefined);
    const prompt = generateText.mock.calls[0][0].turns[0].content as string;
    expect(prompt).toContain("Mentored two PMs.");
  });

  it("8 verification grading sends the resume JSON, content intact", async () => {
    generateText.mockResolvedValue(JSON.stringify({ score: 80, feedback: "ok", concerns: [] }));
    const grade = await gradeResumeForVerification(resume);
    expect(grade.passed).toBe(true);
    expect(generateText.mock.calls[0][0].turns[0].content).toContain("Mentored two PMs.");
  });

  it("9 an application resume snapshot keeps the experience exactly as stored", () => {
    const snapshot = parseResumeSnapshot({ title: "Resume", structuredContent: resume, resumeId: "r1", capturedAt: "2026-01-01" });
    expect(snapshot?.content.experience[0]).toEqual(entry);
  });

  it("10 the example guard does not flag it, and does not throw", () => {
    expect(findUneditedExampleFields(resume)).toEqual([]);
  });

  it("11 Farah's chat context and match scoring read only title / company / skills, so the shape is irrelevant", () => {
    expect(buildResumeContext(resume)).toContain("Most recent role: PM at Acme");
    const score = computeMatchScore(resume, ["product management", "sql"], undefined);
    expect(score.score).toBeGreaterThan(0);
  });
});
