/**
 * `tailorResumeToJob`'s own LLM schema was deliberately NOT widened in this
 * PR — teaching the model to rewrite links/languages/awards/publications/
 * volunteering/customSections/referencesOnRequest is scoped to a later
 * milestone, alongside the template layouts that would actually show them
 * differently. What this PR DOES require: a base resume that has any of
 * these fields must not lose them just because tailoring ran — see
 * `preserveNewFields` in src/lib/tailoring/tailor.ts.
 *
 * The LLM is mocked, same convention as jd-truncation.test.ts and
 * fabrication-backstop.test.ts: this is a contract test about
 * tailorResumeToJob's own behaviour, not about model quality, and it must
 * run in CI without spending API budget.
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
  contact: { name: "Tolu Adebayo" },
  skills: ["Product Management", "SQL"],
  experience: [
    {
      title: "Product Manager",
      company: "Fintech Co",
      bullets: ["Shipped the onboarding redesign.", "Cut signup drop-off by 12%."],
    },
    {
      title: "Associate PM",
      company: "Startup Co",
      description: "Owned the referrals feature end to end.",
    },
  ],
  links: [{ label: "Portfolio", url: "https://example.com/tolu" }],
  languages: [{ name: "Yoruba", level: "Native" }],
  awards: ["Rising Star Award, Fintech Co (2024)"],
  publications: ["Designing onboarding for low-bandwidth users (2023)"],
  volunteering: [{ role: "Mentor", organisation: "Product School", description: "Mentored junior PMs." }],
  customSections: [{ title: "Impact", items: ["Grew MAU from 10k to 80k"] }],
  referencesOnRequest: true,
};

/**
 * A tailoring response that only ever touches the fields the schema asks
 * about — it deliberately rewrites titles/descriptions to prove those DO
 * change (this is the model's normal job) while the new fields are simply
 * absent from what the model returns, exactly like a real unwidened schema
 * would produce.
 */
function tailoringResponse() {
  return JSON.stringify({
    structuredJd: { skills: ["Product Management"], keywords: [], responsibilities: [] },
    gapAnalysis: [],
    tailoredResume: {
      contact: { name: "Tolu Adebayo" },
      experience: [
        {
          title: "Product Manager",
          company: "Fintech Co",
          description: "Rewrote for this JD — kept the same role.",
        },
        {
          title: "Associate PM",
          company: "Startup Co",
          description: "Owned the referrals feature end to end.",
        },
      ],
      education: [],
      skills: ["Product Management", "SQL"],
      projects: [],
      certifications: [],
    },
    atsScore: 82,
    atsFixes: [],
  });
}

beforeEach(() => {
  generateText.mockReset();
  generateText.mockResolvedValue(tailoringResponse());
});

describe("tailorResumeToJob preserves this PR's new fields rather than dropping them", () => {
  it("carries every top-level new field through from the base resume, unchanged", async () => {
    const result = await tailorResumeToJob(BASE_RESUME, "Looking for a Product Manager.", false);

    expect(result.tailoredResume.links).toEqual(BASE_RESUME.links);
    expect(result.tailoredResume.languages).toEqual(BASE_RESUME.languages);
    expect(result.tailoredResume.awards).toEqual(BASE_RESUME.awards);
    expect(result.tailoredResume.publications).toEqual(BASE_RESUME.publications);
    expect(result.tailoredResume.volunteering).toEqual(BASE_RESUME.volunteering);
    expect(result.tailoredResume.customSections).toEqual(BASE_RESUME.customSections);
    expect(result.tailoredResume.referencesOnRequest).toBe(true);
  });

  it("re-attaches bullets to the matching tailored experience entry (matched by title+company)", async () => {
    const result = await tailorResumeToJob(BASE_RESUME, "Looking for a Product Manager.", false);

    const pm = result.tailoredResume.experience.find(
      (e) => e.title === "Product Manager" && e.company === "Fintech Co",
    );
    expect(pm?.bullets).toEqual(BASE_RESUME.experience[0].bullets);
    // The model's own rewrite of description is still what's shown — bullets
    // preservation doesn't clobber a legitimate tailored rewrite.
    expect(pm?.description).toBe("Rewrote for this JD — kept the same role.");
  });

  it("does not attach bullets to an entry that never had them", async () => {
    const result = await tailorResumeToJob(BASE_RESUME, "Looking for a Product Manager.", false);
    const associate = result.tailoredResume.experience.find((e) => e.title === "Associate PM");
    expect(associate?.bullets).toBeUndefined();
  });

  it("a base resume with none of the new fields still tailors cleanly (no field appears from nowhere)", async () => {
    const plainBase = { ...EMPTY_RESUME, contact: { name: "No Extras" }, skills: ["SQL"] };
    const result = await tailorResumeToJob(plainBase, "Looking for a Product Manager.", false);

    expect(result.tailoredResume.links).toBeUndefined();
    expect(result.tailoredResume.languages).toBeUndefined();
    expect(result.tailoredResume.awards).toBeUndefined();
    expect(result.tailoredResume.publications).toBeUndefined();
    expect(result.tailoredResume.volunteering).toBeUndefined();
    expect(result.tailoredResume.customSections).toBeUndefined();
    expect(result.tailoredResume.referencesOnRequest).toBeUndefined();
  });
});
