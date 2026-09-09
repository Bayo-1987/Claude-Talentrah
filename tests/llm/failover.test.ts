/**
 * send-112 — Groq→Gemini failover on a rate-limit error.
 *
 * WHY THIS EXISTS. send-109 traced a live Farah-chat outage to Groq's
 * 200,000-token DAILY quota (a different cap than the per-minute one
 * token-budget.test.ts already guards): once the account crossed it,
 * EVERY LLM call — chat, tailoring, scholarship actions — failed outright
 * for the rest of the day, with no automatic recovery. `generateWithFailover`
 * (src/lib/llm/index.ts) is the fix: retry the exact same request once
 * against Gemini before giving up.
 *
 * Scoped narrowly on purpose: only a `rate_limit` LLMProviderError should
 * trigger the retry. An `auth` or `unknown` error means something is
 * actually broken, and routing around a broken primary silently would hide
 * that rather than fail loudly — the two tests below for those kinds are
 * the ones that catch a scoping mistake (e.g. failing over on anything that
 * throws).
 *
 * The real provider classes are mocked at the module boundary — this is
 * about generateWithFailover's own retry/no-retry decision, not about
 * either provider's real HTTP behaviour (that's covered by
 * groq-provider.ts / gemini-provider.ts's own error-classification, which
 * this test takes as a given by constructing real LLMProviderError
 * instances the same way those adapters do).
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

/** Fresh module instance with LLM_PROVIDER=groq, so `selectedProvider` (computed at import time) is the mocked GroqProvider. */
async function loadWithGroqPrimary() {
  process.env.LLM_PROVIDER = "groq";
  vi.resetModules();
  return import("@/lib/llm");
}

const REQUEST = { turns: [], maxOutputTokens: 10 };

beforeEach(() => {
  groqGenerateText.mockReset();
  geminiGenerateText.mockReset();
});

afterEach(() => {
  process.env.LLM_PROVIDER = ORIGINAL_LLM_PROVIDER;
  vi.resetModules();
});

describe("generateWithFailover", () => {
  it("retries the same request against Gemini when Groq throws rate_limit", async () => {
    const { LLMProviderError, generateWithFailover } = await loadWithGroqPrimary();
    groqGenerateText.mockRejectedValue(
      new LLMProviderError(
        "groq",
        "rate_limit",
        "429 ... on tokens per day (TPD): Limit 200000, Used 199770, Requested 2002. Please try again in 12m45.504s.",
      ),
    );
    geminiGenerateText.mockResolvedValue("gemini reply");

    const result = await generateWithFailover((provider) => provider.generateText(REQUEST));

    expect(result).toBe("gemini reply");
    expect(groqGenerateText).toHaveBeenCalledTimes(1);
    expect(geminiGenerateText).toHaveBeenCalledTimes(1);
    expect(geminiGenerateText).toHaveBeenCalledWith(REQUEST);
  });

  it("does NOT fail over on an auth error — propagates it instead", async () => {
    const { LLMProviderError, generateWithFailover } = await loadWithGroqPrimary();
    groqGenerateText.mockRejectedValue(new LLMProviderError("groq", "auth", "401 invalid key"));

    await expect(generateWithFailover((provider) => provider.generateText(REQUEST))).rejects.toThrow(
      "invalid key",
    );
    expect(geminiGenerateText).not.toHaveBeenCalled();
  });

  it("does NOT fail over on an unknown error — propagates it instead", async () => {
    const { LLMProviderError, generateWithFailover } = await loadWithGroqPrimary();
    groqGenerateText.mockRejectedValue(new LLMProviderError("groq", "unknown", "Groq returned an empty response."));

    await expect(generateWithFailover((provider) => provider.generateText(REQUEST))).rejects.toThrow(
      "empty response",
    );
    expect(geminiGenerateText).not.toHaveBeenCalled();
  });

  it("surfaces a real error when the fallback ALSO rate-limits, rather than an empty result", async () => {
    const { LLMProviderError, generateWithFailover } = await loadWithGroqPrimary();
    groqGenerateText.mockRejectedValue(new LLMProviderError("groq", "rate_limit", "groq exhausted"));
    geminiGenerateText.mockRejectedValue(new LLMProviderError("gemini", "rate_limit", "gemini exhausted too"));

    await expect(generateWithFailover((provider) => provider.generateText(REQUEST))).rejects.toThrow(
      "gemini exhausted too",
    );
    expect(groqGenerateText).toHaveBeenCalledTimes(1);
    expect(geminiGenerateText).toHaveBeenCalledTimes(1);
  });

  it("does not construct a Gemini fallback when the primary isn't groq (no real incident to serve yet)", async () => {
    process.env.LLM_PROVIDER = "gemini";
    vi.resetModules();
    const { LLMProviderError, generateWithFailover } = await import("@/lib/llm");
    geminiGenerateText.mockRejectedValue(new LLMProviderError("gemini", "rate_limit", "gemini exhausted"));

    await expect(generateWithFailover((provider) => provider.generateText(REQUEST))).rejects.toThrow(
      "gemini exhausted",
    );
    // Only the primary (Gemini) was called — no second provider to fail over to.
    expect(geminiGenerateText).toHaveBeenCalledTimes(1);
  });
});
