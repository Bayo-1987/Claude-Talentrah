/**
 * Stage 8 Step 1b's provider selection and isolation guard
 * (src/lib/llm/jd-extraction/).
 *
 * The most important test in this file is the isolation guard one: the
 * original task framing ("a dedicated key, isolated from Farah's quota")
 * would, read naively, produce a second Groq API key on the SAME account as
 * production's GROQ_API_KEY — which is NOT isolation, because Groq's daily
 * token budget (TPD) is shared per ACCOUNT, not per key (CLAUDE.md's own
 * incident history — this exact cap took Farah chat down twice, send-109 /
 * send-112). GroqJdExtractionProvider refuses to start if its own env var
 * equals GROQ_API_KEY, turning the single most likely real misconfiguration
 * into a loud failure instead of a silently shared budget.
 *
 * Both the default-to-stub behaviour and the real Groq path are covered.
 * The real path mocks the "openai" SDK at the module boundary, the same
 * approach tests/llm/provider-timeout.test.ts and tests/llm/failover.test.ts
 * already use — no real network call anywhere in this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let capturedOptions: { apiKey?: string; baseURL?: string } | undefined;
let createImpl: () => Promise<unknown>;

vi.mock("openai", () => {
  class APIError extends Error {
    status?: number;
    constructor(status: number | undefined, _error: unknown, message: string) {
      super(message);
      this.status = status;
    }
  }
  const OpenAIMock = vi.fn().mockImplementation(function (
    this: { chat: { completions: { create: () => Promise<unknown> } } },
    opts: { apiKey?: string; baseURL?: string },
  ) {
    capturedOptions = opts;
    this.chat = { completions: { create: () => createImpl() } };
  });
  return { default: OpenAIMock, APIError };
});

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  capturedOptions = undefined;
  delete process.env.JD_EXTRACTION_LLM_PROVIDER;
  delete process.env.JD_EXTRACTION_GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getJdExtractionProvider — default is the safe stub", () => {
  it("resolves to the stub when JD_EXTRACTION_LLM_PROVIDER is unset", async () => {
    const { getJdExtractionProvider } = await import("@/lib/llm/jd-extraction");
    expect(getJdExtractionProvider().name).toBe("stub");
  });

  it("resolves to the stub on an unrecognised value too — never a fallback to a real provider", async () => {
    process.env.JD_EXTRACTION_LLM_PROVIDER = "definitely-not-a-real-provider";
    const { getJdExtractionProvider } = await import("@/lib/llm/jd-extraction");
    expect(getJdExtractionProvider().name).toBe("stub");
  });

  it("resolves to GroqJdExtractionProvider only when explicitly set to \"groq\"", async () => {
    process.env.JD_EXTRACTION_LLM_PROVIDER = "groq";
    const { getJdExtractionProvider } = await import("@/lib/llm/jd-extraction");
    expect(getJdExtractionProvider().name).toBe("groq-jd-extraction");
  });
});

describe("StubJdExtractionProvider", () => {
  it("returns a fixed, obviously-synthetic result with zero real usage", async () => {
    const { StubJdExtractionProvider } = await import("@/lib/llm/jd-extraction/stub-provider");
    const result = await new StubJdExtractionProvider().extractSkills();
    expect(result.skills).toEqual(["stub-jd-extraction-skill"]);
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: null });
  });
});

describe("GroqJdExtractionProvider — isolation guard", () => {
  it("refuses to run when JD_EXTRACTION_GROQ_API_KEY is not set", async () => {
    const { GroqJdExtractionProvider } = await import("@/lib/llm/jd-extraction/groq-provider");
    await expect(new GroqJdExtractionProvider().extractSkills("a JD")).rejects.toThrow(
      /JD_EXTRACTION_GROQ_API_KEY is not set/,
    );
  });

  it("SABOTAGE-PROOF TARGET: refuses to run when JD_EXTRACTION_GROQ_API_KEY equals GROQ_API_KEY", async () => {
    // The exact real-world mistake this guard exists to catch: someone pastes
    // the already-working production Groq key into the new env var because
    // "it already works", silently making this feature a second consumer of
    // Farah's own shared daily token budget.
    process.env.GROQ_API_KEY = "same-key-both-vars";
    process.env.JD_EXTRACTION_GROQ_API_KEY = "same-key-both-vars";
    const { GroqJdExtractionProvider } = await import("@/lib/llm/jd-extraction/groq-provider");
    await expect(new GroqJdExtractionProvider().extractSkills("a JD")).rejects.toThrow(
      /SAME value as GROQ_API_KEY/,
    );
    // And it must never have reached the HTTP layer to get there.
    expect(capturedOptions).toBeUndefined();
  });

  it("proceeds normally when the two env vars genuinely differ", async () => {
    process.env.GROQ_API_KEY = "farahs-production-key";
    process.env.JD_EXTRACTION_GROQ_API_KEY = "a-genuinely-different-isolated-key";
    createImpl = () =>
      Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ skills: ["stata", "survey design"] }) } }],
        usage: { prompt_tokens: 400, completion_tokens: 20, total_tokens: 420 },
      });
    const { GroqJdExtractionProvider } = await import("@/lib/llm/jd-extraction/groq-provider");
    const result = await new GroqJdExtractionProvider().extractSkills("a JD needing stata and survey design");

    expect(result.skills).toEqual(["stata", "survey design"]);
    expect(result.usage).toEqual({
      inputTokens: 400,
      outputTokens: 20,
      totalTokens: 420,
      reasoningTokens: null,
    });
    expect(capturedOptions?.apiKey).toBe("a-genuinely-different-isolated-key");
  });

  it("degrades to an empty skill list on an unparseable response rather than throwing", async () => {
    process.env.GROQ_API_KEY = "farahs-production-key";
    process.env.JD_EXTRACTION_GROQ_API_KEY = "isolated-key";
    createImpl = () =>
      Promise.resolve({ choices: [{ message: { content: "not json at all" } }], usage: undefined });
    const { GroqJdExtractionProvider } = await import("@/lib/llm/jd-extraction/groq-provider");
    const result = await new GroqJdExtractionProvider().extractSkills("a JD");
    expect(result.skills).toEqual([]);
  });
});
