/**
 * The LLM fallback's extraction schema (src/lib/resume/llm-fallback.ts) was
 * widened alongside StructuredResume (Template library PR 1/3) to extract
 * links, languages, awards, publications, volunteering, custom sections,
 * "references on request", and per-role bullets — all OPTIONAL, and never
 * invented when the source text doesn't have them.
 *
 * The LLM is mocked, the same way tests/tailoring/jd-truncation.test.ts and
 * fabrication-backstop.test.ts mock it: this is a contract about what
 * `parseResumeWithLLM` does with a given model response, not about real
 * model behaviour, and it must run in CI without spending API budget.
 */
import { describe, expect, it, vi } from "vitest";

const generateText = vi.fn();

const fakeProvider = { name: "test" as const, model: "test", generateText, generateWithUsage: vi.fn() };
vi.mock("@/lib/llm", () => ({
  getLLMProvider: () => fakeProvider,
  generateWithFailover: (call: (p: typeof fakeProvider) => Promise<string>) => call(fakeProvider),
}));

const { parseResumeWithLLM } = await import("@/lib/resume/llm-fallback");

/** A well-formed extraction response using every new field at once. */
function fullResponse() {
  return JSON.stringify({
    contact: { name: "Chidinma Eze", email: "chidinma@example.com" },
    summary: "Backend engineer with six years building payment systems.",
    experience: [
      {
        title: "Senior Engineer",
        company: "Paystack",
        bullets: ["Built the settlement reconciliation service.", "Cut p99 latency by 40%."],
      },
    ],
    education: [{ school: "University of Lagos" }],
    skills: ["Node.js", "Postgres"],
    projects: [],
    certifications: [],
    links: [{ label: "GitHub", url: "https://github.com/chidinma" }],
    languages: [{ name: "Igbo", level: "Native" }],
    awards: ["Hackathon winner, DevFest Lagos 2023"],
    publications: ["Scaling settlement systems, Paystack Engineering Blog (2024)"],
    volunteering: [
      { role: "Workshop Lead", organisation: "She Code Africa", description: "Taught intro backend workshops." },
    ],
    customSections: [{ title: "Open Source", items: ["Maintainer, node-paystack"] }],
    referencesOnRequest: true,
  });
}

describe("parseResumeWithLLM — new fields round-trip", () => {
  it("preserves every new field the model extracted, unchanged", async () => {
    generateText.mockReset();
    generateText.mockResolvedValueOnce(fullResponse());

    const resume = await parseResumeWithLLM("irrelevant raw text — the LLM call is mocked");

    expect(resume.experience[0].bullets).toEqual([
      "Built the settlement reconciliation service.",
      "Cut p99 latency by 40%.",
    ]);
    expect(resume.links).toEqual([{ label: "GitHub", url: "https://github.com/chidinma" }]);
    expect(resume.languages).toEqual([{ name: "Igbo", level: "Native" }]);
    expect(resume.awards).toEqual(["Hackathon winner, DevFest Lagos 2023"]);
    expect(resume.publications).toEqual(["Scaling settlement systems, Paystack Engineering Blog (2024)"]);
    expect(resume.volunteering).toEqual([
      { role: "Workshop Lead", organisation: "She Code Africa", description: "Taught intro backend workshops." },
    ]);
    expect(resume.customSections).toEqual([{ title: "Open Source", items: ["Maintainer, node-paystack"] }]);
    expect(resume.referencesOnRequest).toBe(true);
  });

  it("does not invent any new field when the model's response omits all of them", async () => {
    generateText.mockReset();
    generateText.mockResolvedValueOnce(
      JSON.stringify({
        contact: { name: "Chidinma Eze" },
        summary: "",
        experience: [{ title: "Senior Engineer", company: "Paystack", description: "Built payment APIs." }],
        education: [],
        skills: ["Node.js"],
        projects: [],
        certifications: [],
      }),
    );

    const resume = await parseResumeWithLLM("irrelevant raw text — the LLM call is mocked");

    expect(resume.links).toBeUndefined();
    expect(resume.languages).toBeUndefined();
    expect(resume.awards).toBeUndefined();
    expect(resume.publications).toBeUndefined();
    expect(resume.volunteering).toBeUndefined();
    expect(resume.customSections).toBeUndefined();
    expect(resume.referencesOnRequest).toBeUndefined();
    expect(resume.experience[0].bullets).toBeUndefined();
    // The field that WAS there must still come through — this isn't just
    // "everything is empty", it's specifically the new fields that are absent.
    expect(resume.experience[0].description).toBe("Built payment APIs.");
  });

  it("never populates both bullets and description from the same response entry differently than the model said", async () => {
    // The model is instructed never to set both — this proves the app layer
    // doesn't quietly merge or invent one from the other if it somehow did.
    generateText.mockReset();
    generateText.mockResolvedValueOnce(
      JSON.stringify({
        contact: {},
        experience: [
          {
            title: "PM",
            company: "Fintech Co",
            bullets: ["Shipped the redesign."],
          },
        ],
        education: [],
        skills: [],
        projects: [],
        certifications: [],
      }),
    );

    const resume = await parseResumeWithLLM("irrelevant");
    expect(resume.experience[0].bullets).toEqual(["Shipped the redesign."]);
    expect(resume.experience[0].description).toBeUndefined();
  });
});
