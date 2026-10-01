/**
 * Bullets survive the whole tailoring chain: LLM output -> structured resume
 * -> save (the route's JSON insert) -> render (every template) as real <li>s.
 * The last hop, rendered page -> PDF, is e2e/resume-print-margins.spec.ts.
 *
 * What went wrong before: the tailoring schema only let the model return ONE
 * `description` string per role, so several achievements came back as a single
 * run-on paragraph (or a string with typed "- " dashes), and the base
 * resume's own bullets were re-attached untouched over the top of whatever the
 * model had written. Now the schema asks for a `bullets` array, one entry per
 * achievement, and anything glued together or carrying its own markers is split
 * and cleaned before it is saved.
 *
 * The LLM is mocked, like jd-truncation.test.ts and new-fields-preserved.test.ts:
 * this is a contract test of tailorResumeToJob, not of model quality.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const generateText = vi.fn();
const fakeProvider = { name: "test" as const, model: "test", generateText, generateWithUsage: vi.fn() };
vi.mock("@/lib/llm", () => ({
  getLLMProvider: () => fakeProvider,
  generateWithFailover: (call: (p: typeof fakeProvider) => Promise<string>) => call(fakeProvider),
}));
vi.mock("@/lib/tailoring/cache", () => ({
  computeTailoringCacheKey: () => ({ cacheKey: "unused", jdTextHash: "unused", resumeContentHash: "unused" }),
  getCachedTailoringResult: async () => null,
  saveTailoringResult: async () => {},
}));

const { tailorResumeToJob } = await import("@/lib/tailoring/tailor");
const { mergeAcceptedAdditions } = await import("@/lib/tailoring/apply-additions");
const { TemplateRenderer, registeredSlugs } = await import("@/components/resume-builder/templates");
const { EMPTY_RESUME } = await import("@/lib/resume/types");
const { sanitizeStructuredResume } = await import("@/lib/resume/sanitize");

const BASE = {
  ...EMPTY_RESUME,
  contact: { name: "Ada Obi" },
  skills: ["Project Management", "SQL"],
  experience: [
    {
      title: "Product Manager",
      company: "Fintech Co",
      startDate: "September 2022",
      endDate: "present",
      bullets: ["Shipped the onboarding redesign.", "Cut signup drop-off by 12%.", "Mentored two junior PMs."],
    },
    { title: "Associate PM", company: "Startup Co", description: "Owned the referrals feature end to end." },
  ],
};

function respond(experience: unknown[], extra: Record<string, unknown> = {}) {
  generateText.mockResolvedValue(
    JSON.stringify({
      structuredJd: { skills: ["Product Management"], keywords: [], responsibilities: [] },
      gapAnalysis: [],
      tailoredResume: {
        contact: { name: "Ada Obi" },
        experience,
        education: [],
        skills: ["Project Management", "SQL"],
        projects: [],
        certifications: [],
        ...extra,
      },
      atsScore: 80,
      atsFixes: [],
    }),
  );
}

const JD = "Looking for a Product Manager with onboarding experience.";

beforeEach(() => {
  generateText.mockReset();
});

describe("the tailoring request asks for one achievement per bullet", () => {
  it("gives each experience entry a `bullets` array and says never to merge them", async () => {
    respond([]);
    await tailorResumeToJob(BASE, JD, false);
    const schema = generateText.mock.calls[0][0].jsonSchema;
    const bullets = schema.properties.tailoredResume.properties.experience.items.properties.bullets;
    expect(bullets, "the response schema has no bullets field, so the model can only return one merged string").toBeDefined();
    expect(bullets.type).toBe("array");
    expect(bullets.items).toEqual({ type: "string" });
    expect(bullets.description).toMatch(/one (array entry|achievement)/i);
    expect(bullets.description).toMatch(/never merge/i);
  });

  it("sends the base resume's bullets as an array (not pre-joined) so the model sees the structure", async () => {
    respond([]);
    await tailorResumeToJob(BASE, JD, false);
    const prompt = generateText.mock.calls[0][0].turns[0].content as string;
    const sent = JSON.parse(prompt.split("base resume as JSON:\n")[1].split("\n\nHere is the job")[0]);
    expect(sent.experience[0].bullets).toEqual(BASE.experience[0].bullets);
  });
});

describe("tailorResumeToJob keeps one achievement per bullet", () => {
  it("a bullets array comes through as the same number of bullets, in order", async () => {
    respond([
      { title: "Product Manager", company: "Fintech Co", bullets: ["Led onboarding redesign.", "Cut drop-off by 12%.", "Mentored two PMs."] },
      { title: "Associate PM", company: "Startup Co", description: "Owned the referrals feature end to end." },
    ]);
    const { tailoredResume } = await tailorResumeToJob(BASE, JD, false);
    expect(tailoredResume.experience[0].bullets).toEqual(["Led onboarding redesign.", "Cut drop-off by 12%.", "Mentored two PMs."]);
    // The model's rewrite wins over the base resume's own bullets.
    expect(tailoredResume.experience[0].bullets).not.toEqual(BASE.experience[0].bullets);
  });

  it("several achievements glued into ONE bullet string are split apart, markers removed", async () => {
    respond([
      {
        title: "Product Manager",
        company: "Fintech Co",
        bullets: ["• Led onboarding redesign. • Cut drop-off by 12%. • Mentored two PMs."],
      },
    ]);
    const { tailoredResume } = await tailorResumeToJob(BASE, JD, false);
    expect(tailoredResume.experience[0].bullets).toEqual(["Led onboarding redesign.", "Cut drop-off by 12%.", "Mentored two PMs."]);
  });

  it(
    "glued achievements LONGER than the sanitizer's per-item cap are split first, not dropped as degenerate " +
      "(otherwise the whole rewrite is thrown away and the base bullets come back)",
    async () => {
      const achievements = [
        "Led the redesign of the onboarding flow across web and mobile, working with design, engineering and compliance.",
        "Cut signup drop-off by 12% over two quarters by removing three redundant steps and rewriting the error copy.",
        "Mentored two junior product managers through their first launches and their first quarterly planning cycles.",
        "Introduced a weekly metrics review that gave every squad one shared view of activation and retention.",
      ];
      const glued = achievements.map((a) => `• ${a}`).join(" ");
      expect(glued.length, "the fixture must exceed the 200-character item cap to mean anything").toBeGreaterThan(200);
      respond([{ title: "Product Manager", company: "Fintech Co", bullets: [glued] }]);
      const { tailoredResume } = await tailorResumeToJob(BASE, JD, false);
      expect(tailoredResume.experience[0].bullets).toEqual(achievements);
    },
  );

  it("a bullet holding newline-separated, dash-prefixed lines becomes separate bullets with no dashes left", async () => {
    respond([
      { title: "Product Manager", company: "Fintech Co", bullets: ["- Led onboarding redesign.\n- Cut drop-off by 12%."] },
    ]);
    const { tailoredResume } = await tailorResumeToJob(BASE, JD, false);
    expect(tailoredResume.experience[0].bullets).toEqual(["Led onboarding redesign.", "Cut drop-off by 12%."]);
  });

  it("a typed list returned in `description` becomes bullets, and description keeps a plain-text fallback", async () => {
    respond([
      { title: "Product Manager", company: "Fintech Co", description: "- Led onboarding redesign.\n- Cut drop-off by 12%.\n- Mentored two PMs." },
    ]);
    const { tailoredResume } = await tailorResumeToJob(BASE, JD, false);
    const entry = tailoredResume.experience[0];
    expect(entry.bullets).toEqual(["Led onboarding redesign.", "Cut drop-off by 12%.", "Mentored two PMs."]);
    expect(entry.description).toBe("Led onboarding redesign. Cut drop-off by 12%. Mentored two PMs.");
  });

  it("a role described as prose stays prose — no one-item bullet list is invented", async () => {
    respond([
      { title: "Associate PM", company: "Startup Co", description: "Owned the referrals feature end to end." },
    ]);
    const { tailoredResume } = await tailorResumeToJob(BASE, JD, false);
    expect(tailoredResume.experience[0].bullets).toBeUndefined();
    expect(tailoredResume.experience[0].description).toBe("Owned the referrals feature end to end.");
  });

  it("when the model returns no bullets for a role that has them, the base resume's bullets are kept (unchanged behaviour)", async () => {
    respond([{ title: "Product Manager", company: "Fintech Co", description: "A rewritten summary of the role." }]);
    const { tailoredResume } = await tailorResumeToJob(BASE, JD, false);
    expect(tailoredResume.experience[0].bullets).toEqual(BASE.experience[0].bullets);
  });

  it("a JD-lifted phrase inside a bullet reverts the entry to the base bullets and proposes the bullets as one editable addition", async () => {
    generateText.mockResolvedValue(
      JSON.stringify({
        structuredJd: { skills: [], keywords: [], responsibilities: ["capacity planning for regional teams"] },
        gapAnalysis: [],
        tailoredResume: {
          contact: { name: "Ada Obi" },
          experience: [
            {
              title: "Product Manager",
              company: "Fintech Co",
              bullets: ["Led onboarding redesign.", "Owned capacity planning for regional teams."],
            },
          ],
          education: [],
          skills: ["Project Management"],
          projects: [],
          certifications: [],
        },
        atsScore: 80,
        atsFixes: [],
      }),
    );
    const { tailoredResume, proposedAdditions } = await tailorResumeToJob(BASE, JD, false);
    expect(tailoredResume.experience[0].bullets).toEqual(BASE.experience[0].bullets);
    const addition = proposedAdditions.find((a) => a.section === "experience");
    expect(addition?.text).toBe("Led onboarding redesign.\nOwned capacity planning for regional teams.");
  });
});

describe("accepting a proposed experience rewrite keeps one bullet per line", () => {
  const resume = { ...BASE, experience: [{ ...BASE.experience[0] }] };

  it("multi-line text becomes bullets", () => {
    const merged = mergeAcceptedAdditions(resume, [
      { id: "a", section: "experience", experienceIndex: 0, text: "Led onboarding redesign.\nCut drop-off by 12%.", reason: "", source: "model" },
    ]);
    expect(merged.experience[0].bullets).toEqual(["Led onboarding redesign.", "Cut drop-off by 12%."]);
  });

  it("a role that had bullets keeps a list even when the accepted text is one line", () => {
    const merged = mergeAcceptedAdditions(resume, [
      { id: "a", section: "experience", experienceIndex: 0, text: "Led onboarding redesign.", reason: "", source: "model" },
    ]);
    expect(merged.experience[0].bullets).toEqual(["Led onboarding redesign."]);
  });

  it("a role described as prose keeps description (unchanged behaviour)", () => {
    const prose = { ...BASE, experience: [{ title: "Associate PM", company: "Startup Co", description: "Old text." }] };
    const merged = mergeAcceptedAdditions(prose, [
      { id: "a", section: "experience", experienceIndex: 0, text: "New text.", reason: "", source: "model" },
    ]);
    expect(merged.experience[0].description).toBe("New text.");
    expect(merged.experience[0].bullets).toBeUndefined();
  });
});

describe("tailoring -> save -> render", () => {
  it("what the route saves (JSON insert, then sanitize on read) still has every bullet, and every template renders each as its own <li>", async () => {
    respond([
      {
        title: "Product Manager",
        company: "Fintech Co",
        startDate: "September 2022",
        endDate: "present",
        bullets: ["• Led onboarding redesign. • Cut drop-off by 12%.", "Mentored two PMs."],
      },
    ]);
    const { tailoredResume } = await tailorResumeToJob(BASE, JD, false);

    // The route stores `JSON.parse(JSON.stringify(result.tailoredResume))`; a later save goes through sanitize.
    const saved = sanitizeStructuredResume(JSON.parse(JSON.stringify(tailoredResume)));
    expect(saved.experience[0].bullets).toEqual(["Led onboarding redesign.", "Cut drop-off by 12%.", "Mentored two PMs."]);

    for (const slug of registeredSlugs()) {
      const html = renderToStaticMarkup(createElement(TemplateRenderer, { slug, resume: saved }));
      for (const bullet of saved.experience[0].bullets!) {
        expect(html, `${slug}: "${bullet}" is not its own <li>`).toContain(`<li>${bullet}</li>`);
      }
      // No fake dash or glyph left inside the text.
      expect(html, `${slug}: a typed bullet marker survived into the page`).not.toMatch(/>\s*[•\-–]\s+(Led|Cut|Mentored)/);
    }
  });
});
