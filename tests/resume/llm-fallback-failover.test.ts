/**
 * send-112 follow-up — `parseResumeWithLLM`'s own LLM call (the 6th real
 * caller of generateText, found after the original failover PR shipped
 * without it) now goes through `generateWithFailover` too. This is the
 * heuristic-resume-parser's fallback path — a real user upload the rules-
 * based parser came back low-confidence on, not a rare corner case — so a
 * Groq daily-quota outage (send-109) used to hard-fail resume uploads here
 * with no recovery, same as chat/tailoring/scholarships did before send-112.
 *
 * Same pattern and same two properties as tests/llm/failover.test.ts:
 * a `rate_limit` error retries against Gemini and returns its result;
 * `auth`/`unknown` errors propagate unchanged rather than silently routing
 * around what might be a real outage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const groqGenerateText = vi.fn();
const geminiGenerateText = vi.fn();

vi.mock("@/lib/llm/groq-provider", () => ({
  GroqProvider: vi.fn().mockImplementation(function GroqProvider() {
    return { name: "groq", model: "groq-test", generateText: groqGenerateText, generateWithUsage: vi.fn() };
  }),
}));

vi.mock("@/lib/llm/gemini-provider", () => ({
  GeminiProvider: vi.fn().mockImplementation(function GeminiProvider() {
    return { name: "gemini", model: "gemini-test", generateText: geminiGenerateText, generateWithUsage: vi.fn() };
  }),
}));

vi.mock("@/lib/llm/stub-provider", () => ({
  StubProvider: vi.fn(),
}));

const ORIGINAL_LLM_PROVIDER = process.env.LLM_PROVIDER;

/** A minimal well-formed extraction response so parseResumeWithLLM completes without a retry. */
function stubExtraction() {
  return JSON.stringify({
    contact: { name: "Ada Obi" },
    experience: [{ title: "Engineer", company: "Flutterwave" }],
    education: [{ school: "UNILAG" }],
    skills: ["TypeScript"],
  });
}

async function loadWithGroqPrimary() {
  process.env.LLM_PROVIDER = "groq";
  vi.resetModules();
  const [{ LLMProviderError }, { parseResumeWithLLM }] = await Promise.all([
    import("@/lib/llm"),
    import("@/lib/resume/llm-fallback"),
  ]);
  return { LLMProviderError, parseResumeWithLLM };
}

beforeEach(() => {
  groqGenerateText.mockReset();
  geminiGenerateText.mockReset();
});

afterEach(() => {
  process.env.LLM_PROVIDER = ORIGINAL_LLM_PROVIDER;
  vi.resetModules();
});

describe("parseResumeWithLLM failover", () => {
  it("retries against Gemini when Groq's extraction call throws rate_limit", async () => {
    const { LLMProviderError, parseResumeWithLLM } = await loadWithGroqPrimary();
    groqGenerateText.mockRejectedValue(new LLMProviderError("groq", "rate_limit", "429 ... TPD exhausted"));
    geminiGenerateText.mockResolvedValue(stubExtraction());

    const resume = await parseResumeWithLLM("Ada Obi\nEngineer at Flutterwave\nUNILAG\nTypeScript");

    expect(resume.contact.name).toBe("Ada Obi");
    expect(geminiGenerateText).toHaveBeenCalledTimes(1);
  });

  it("does NOT fail over on an auth error — propagates it instead", async () => {
    const { LLMProviderError, parseResumeWithLLM } = await loadWithGroqPrimary();
    groqGenerateText.mockRejectedValue(new LLMProviderError("groq", "auth", "401 invalid key"));

    await expect(parseResumeWithLLM("some resume text")).rejects.toThrow("invalid key");
    expect(geminiGenerateText).not.toHaveBeenCalled();
  });

  it("does NOT fail over on an unknown error — propagates it instead", async () => {
    const { LLMProviderError, parseResumeWithLLM } = await loadWithGroqPrimary();
    groqGenerateText.mockRejectedValue(new LLMProviderError("groq", "unknown", "Groq returned an empty response."));

    await expect(parseResumeWithLLM("some resume text")).rejects.toThrow("empty response");
    expect(geminiGenerateText).not.toHaveBeenCalled();
  });
});
