/**
 * Regression test for silent JD truncation.
 *
 * The tailoring path capped pasted job descriptions at 8,000 characters and
 * said nothing. Measured against the 140 ingested postings, that fired on 18
 * of them — roughly one JD in eight — so a user pasting a detailed posting
 * routinely got a result built from part of their input, with no indication.
 * A weaker result then reads as the product being bad rather than as us
 * having dropped half the input.
 *
 * Two properties are guarded here, and both matter:
 *   1. A JD within the cap is passed through whole and reports no
 *      truncation. Without this, a cap of zero would satisfy test 2.
 *   2. A JD over the cap still reports truncation, with honest numbers.
 *      This is the one that fails if someone reintroduces a bare slice.
 *
 * The LLM is stubbed — this is about the truncation contract, not model
 * behaviour, and it must run in CI without spending API budget or depending
 * on a provider being reachable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.fn();

vi.mock("@/lib/llm", () => ({
  getLLMProvider: () => ({ name: "groq", model: "test", generateText, generateWithUsage: vi.fn() }),
}));

const { tailorResumeToJob, JD_MAX_CHARS } = await import("@/lib/tailoring/tailor");
const { EMPTY_RESUME } = await import("@/lib/resume/types");

/** Minimal well-formed response so the tailoring path completes without a retry. */
function stubResponse() {
  return JSON.stringify({
    structuredJd: { skills: [], keywords: [], responsibilities: [] },
    gapAnalysis: [],
    tailoredResume: {
      contact: {},
      experience: [],
      education: [],
      skills: [],
      projects: [],
      certifications: [],
    },
    atsScore: 70,
    atsFixes: [],
  });
}

/** The JD text actually sent to the model on the most recent call. */
function jdSentToModel(): string {
  const prompt = generateText.mock.calls.at(-1)![0].turns[0].content as string;
  return prompt.split("job description I want to tailor it to:\n")[1].split("\n\n")[0];
}

beforeEach(() => {
  generateText.mockReset();
  generateText.mockResolvedValue(stubResponse());
});

describe("JD truncation is never silent", () => {
  it("the cap is documented and large enough for real job descriptions", () => {
    // Longest of the 140 ingested postings is 20,805 characters. A cap below
    // that would silently clip genuine listings, which is the whole bug.
    expect(JD_MAX_CHARS).toBeGreaterThan(20_805);
  });

  it("a normal-length JD is passed through whole and reports no truncation", async () => {
    const jd = "Senior Backend Engineer. ".repeat(100); // ~2.5k chars, typical
    const result = await tailorResumeToJob(EMPTY_RESUME, jd, false);

    expect(result.jdTruncation, "a JD within the cap must not report truncation").toBeNull();
    expect(jdSentToModel()).toHaveLength(jd.length);
  });

  it("a JD exactly at the cap is not reported as truncated (off-by-one guard)", async () => {
    const jd = "x".repeat(JD_MAX_CHARS);
    const result = await tailorResumeToJob(EMPTY_RESUME, jd, false);
    expect(result.jdTruncation).toBeNull();
  });

  it("an over-long JD IS reported, with honest numbers", async () => {
    const jd = "y".repeat(JD_MAX_CHARS + 5_000);
    const result = await tailorResumeToJob(EMPTY_RESUME, jd, false);

    expect(
      result.jdTruncation,
      "SILENT TRUNCATION: an over-long JD was cut with no notice to the user",
    ).not.toBeNull();
    expect(result.jdTruncation!.originalChars).toBe(JD_MAX_CHARS + 5_000);
    expect(result.jdTruncation!.usedChars).toBe(JD_MAX_CHARS);
  });

  it("the model really does receive only the capped portion", async () => {
    const jd = "z".repeat(JD_MAX_CHARS + 5_000);
    await tailorResumeToJob(EMPTY_RESUME, jd, false);
    // The notice would be a lie if the cap weren't actually applied.
    expect(jdSentToModel()).toHaveLength(JD_MAX_CHARS);
  });

  it("the reported length reflects what the user pasted, not what a retry saw", async () => {
    // First attempt returns unparseable JSON, forcing the retry path. The
    // notice must still describe the user's original input.
    generateText.mockResolvedValueOnce("not json at all");
    const jd = "w".repeat(JD_MAX_CHARS + 1_234);
    const result = await tailorResumeToJob(EMPTY_RESUME, jd, false);

    expect(result.jdTruncation!.originalChars).toBe(JD_MAX_CHARS + 1_234);
    expect(generateText).toHaveBeenCalledTimes(2);
  });
});
