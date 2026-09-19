/**
 * send-368 — "Draft with Farah". Pure-function coverage for
 * src/lib/employer/draft-job.ts: the LLM call is mocked (same
 * `vi.mock("@/lib/llm", ...)` pattern as tests/screening/farah-review-llm-
 * failure.test.ts), no real database or wallet involved — that side of the
 * feature (the debit/reversal, requireEmployer, the actually-imported
 * inference functions) is covered separately in draft-job-action.test.ts.
 *
 * This file's job is to prove: (1) assembleJobDescriptionMarkdown produces
 * exactly the subset render-markdown.tsx's own parseBlocks understands, with
 * one real generated example shown round-tripping through
 * renderJobDescriptionMarkdown end-to-end; (2) draftJobDescription validates
 * an LLM response defensively — throwing on the fields it cannot recover
 * from, falling back to null (never a guess) on the two suggestion fields.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderJobDescriptionMarkdown } from "@/lib/farah/render-markdown";

const generateText = vi.fn();
const fakeProvider = { name: "test" as const, model: "test", generateText, generateWithUsage: vi.fn() };

vi.mock("@/lib/llm", () => ({
  getLLMProvider: () => fakeProvider,
  generateWithFailover: (call: (p: typeof fakeProvider) => Promise<string>) => call(fakeProvider),
  LLMProviderError: class LLMProviderError extends Error {
    constructor(
      public provider: string,
      public kind: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

const { assembleJobDescriptionMarkdown, draftJobDescription } = await import("@/lib/employer/draft-job");

afterEach(() => {
  generateText.mockReset();
});

describe("assembleJobDescriptionMarkdown", () => {
  it("assembles a role summary plus all three bulleted sections, blank-line separated", () => {
    const markdown = assembleJobDescriptionMarkdown({
      roleSummary: "We're hiring a Backend Engineer to own our payments API.",
      responsibilities: ["Design REST endpoints", "Own on-call rotation"],
      requirements: ["3+ years Node.js", "Postgres experience"],
      preferred: ["AWS experience"],
    });

    expect(markdown).toBe(
      [
        "We're hiring a Backend Engineer to own our payments API.",
        "## What you'll do\n- Design REST endpoints\n- Own on-call rotation",
        "## What we're looking for\n- 3+ years Node.js\n- Postgres experience",
        "## Preferred\n- AWS experience",
      ].join("\n\n"),
    );
  });

  it("skips a section entirely (no empty heading) when its bullet array is empty — preferred is optional", () => {
    const markdown = assembleJobDescriptionMarkdown({
      roleSummary: "We're hiring a Data Analyst.",
      responsibilities: ["Build dashboards"],
      requirements: ["SQL fluency"],
      preferred: [],
    });

    expect(markdown).not.toContain("## Preferred");
    expect(markdown).toBe(
      ["We're hiring a Data Analyst.", "## What you'll do\n- Build dashboards", "## What we're looking for\n- SQL fluency"].join(
        "\n\n",
      ),
    );
  });

  it("trims the role summary", () => {
    const markdown = assembleJobDescriptionMarkdown({
      roleSummary: "  Extra whitespace around this.  ",
      responsibilities: ["A"],
      requirements: ["B"],
      preferred: [],
    });
    expect(markdown.startsWith("Extra whitespace around this.")).toBe(true);
  });

  it("a real generated example round-trips cleanly through renderJobDescriptionMarkdown", () => {
    const markdown = assembleJobDescriptionMarkdown({
      roleSummary: "We're looking for a Product Designer to shape our core onboarding flow end to end.",
      responsibilities: [
        "Design and prototype new onboarding screens in Figma",
        "Partner with engineering to ship pixel-accurate implementations",
        "Run usability sessions and iterate on findings",
      ],
      requirements: [
        "3+ years of product design experience",
        "A strong portfolio of shipped mobile or web products",
        "Comfort working directly with engineers day to day",
      ],
      preferred: ["Experience designing for emerging markets"],
    });

    // Never throws, and produces real markup for every section — this is the
    // literal shape job-posting-form.tsx's own live preview (via the rich
    // editor) and the seeker-facing job detail page both render through.
    const html = renderToStaticMarkup(renderJobDescriptionMarkdown(markdown) as React.ReactElement);
    expect(html).toContain("We&#x27;re looking for a Product Designer");
    expect(html).toContain("What you&#x27;ll do");
    expect(html).toContain("Design and prototype new onboarding screens in Figma");
    expect(html).toContain("What we&#x27;re looking for");
    expect(html).toContain("Preferred");
    expect(html).toContain("Experience designing for emerging markets");
  });
});

describe("draftJobDescription — response validation", () => {
  it("a well-formed response produces a real description plus both suggestions", async () => {
    generateText.mockResolvedValue(
      JSON.stringify({
        roleSummary: "We're hiring a Backend Engineer.",
        responsibilities: ["Build APIs", "Own services"],
        requirements: ["Node.js experience", "SQL experience"],
        preferred: ["AWS experience"],
        suggestedEmploymentType: "full_time",
        suggestedYearsExperienceMin: 3,
      }),
    );

    const result = await draftJobDescription("Backend Engineer", "Lagos, Nigeria");

    expect(result.description).toContain("We're hiring a Backend Engineer.");
    expect(result.description).toContain("## What you'll do");
    expect(result.suggestedEmploymentType).toBe("full_time");
    expect(result.suggestedYearsExperienceMin).toBe(3);
  });

  it("throws when roleSummary is missing — the caller reverses the wallet charge on any throw", async () => {
    generateText.mockResolvedValue(
      JSON.stringify({
        responsibilities: ["Build APIs"],
        requirements: ["Node.js experience"],
        preferred: [],
      }),
    );
    await expect(draftJobDescription("Backend Engineer", null)).rejects.toThrow(/role summary/i);
  });

  it("throws when responsibilities is empty", async () => {
    generateText.mockResolvedValue(
      JSON.stringify({
        roleSummary: "We're hiring.",
        responsibilities: [],
        requirements: ["Node.js experience"],
        preferred: [],
      }),
    );
    await expect(draftJobDescription("Backend Engineer", null)).rejects.toThrow(/responsibilities/i);
  });

  it("throws when requirements is empty", async () => {
    generateText.mockResolvedValue(
      JSON.stringify({
        roleSummary: "We're hiring.",
        responsibilities: ["Build APIs"],
        requirements: [],
        preferred: [],
      }),
    );
    await expect(draftJobDescription("Backend Engineer", null)).rejects.toThrow(/requirements/i);
  });

  it("an invalid suggestedEmploymentType (not a real enum value) falls back to null, never a guess", async () => {
    generateText.mockResolvedValue(
      JSON.stringify({
        roleSummary: "We're hiring.",
        responsibilities: ["Build APIs"],
        requirements: ["Node.js experience"],
        preferred: [],
        suggestedEmploymentType: "made_up_type",
        suggestedYearsExperienceMin: 2,
      }),
    );
    const result = await draftJobDescription("Backend Engineer", null);
    expect(result.suggestedEmploymentType).toBeNull();
  });

  it("a negative or non-numeric suggestedYearsExperienceMin falls back to null", async () => {
    generateText.mockResolvedValue(
      JSON.stringify({
        roleSummary: "We're hiring.",
        responsibilities: ["Build APIs"],
        requirements: ["Node.js experience"],
        preferred: [],
        suggestedEmploymentType: "full_time",
        suggestedYearsExperienceMin: -5,
      }),
    );
    const result = await draftJobDescription("Backend Engineer", null);
    expect(result.suggestedYearsExperienceMin).toBeNull();
  });

  it("non-string entries in preferred/responsibilities/requirements are filtered out, not thrown on", async () => {
    generateText.mockResolvedValue(
      JSON.stringify({
        roleSummary: "We're hiring.",
        responsibilities: ["Build APIs", 42, null],
        requirements: ["Node.js experience", ""],
        preferred: ["  ", "Real preferred item"],
        suggestedEmploymentType: "full_time",
        suggestedYearsExperienceMin: 1,
      }),
    );
    const result = await draftJobDescription("Backend Engineer", null);
    expect(result.description).toContain("Build APIs");
    expect(result.description).not.toContain("42");
    expect(result.description).toContain("Real preferred item");
  });

  it("a thrown LLM call propagates — never swallowed into a fake result", async () => {
    generateText.mockRejectedValue(new Error("Groq is down"));
    await expect(draftJobDescription("Backend Engineer", null)).rejects.toThrow("Groq is down");
  });

  it("never reads or emits anything salary-related, under any input shape", async () => {
    generateText.mockResolvedValue(
      JSON.stringify({
        roleSummary: "We're hiring.",
        responsibilities: ["Build APIs"],
        requirements: ["Node.js experience"],
        preferred: [],
        suggestedEmploymentType: "full_time",
        suggestedYearsExperienceMin: 2,
        // A hostile or confused model response throwing in salary fields —
        // proves the schema/parsing path has nothing that would read them.
        salaryMin: 500000,
        salaryMax: 900000,
        salaryCurrency: "NGN",
      }),
    );
    const result = await draftJobDescription("Backend Engineer", null);
    expect(result).not.toHaveProperty("salaryMin");
    expect(result).not.toHaveProperty("salaryMax");
    expect(result).not.toHaveProperty("salaryCurrency");
    expect(result.description).not.toMatch(/salary/i);
    expect(JSON.stringify(result)).not.toContain("500000");
  });
});
