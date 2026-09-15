/**
 * send-latency-timeout — groq-provider.ts / gemini-provider.ts had no bounded
 * client timeout. The OpenAI SDK's (and @google/genai's) default is
 * effectively unbounded for practical purposes, so a hung LLM call used to
 * run until the hosting platform killed the function — well past the point
 * where /api/tailoring's own `maxDuration` (see that route's comment) could
 * ever return a normal error response, and well past what the "Working…"
 * client state had anything true left to say.
 *
 * This test proves the fix two ways, for both providers:
 *
 *  1. The underlying SDK client is constructed with a bounded, sane timeout
 *     (GROQ_CLIENT_TIMEOUT_MS / GEMINI_CLIENT_TIMEOUT_MS) — catches the
 *     literal regression of dropping that option again.
 *  2. A call that would otherwise hang forever (no fixed timer scheduled by
 *     the test — see `createHangingCompletion` below) is aborted right at
 *     that configured timeout, not before and not never. If the client
 *     timeout option were ever omitted again, this half of the test would
 *     hang and fail on vitest's own testTimeout rather than pass — the mock
 *     deliberately does NOT schedule its own rejection unless it sees a
 *     positive timeout come through from the real provider code.
 *
 * Both SDKs are mocked at the module boundary (same approach as
 * tests/llm/failover.test.ts) — this is about groq-provider.ts's and
 * gemini-provider.ts's OWN client construction and error classification, not
 * either SDK's real HTTP/retry internals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- openai (Groq) mock -----------------------------------------------

let capturedGroqOptions: { apiKey?: string; baseURL?: string; timeout?: number } | undefined;
let groqCreateImpl: () => Promise<unknown>;

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
    opts: { apiKey?: string; baseURL?: string; timeout?: number },
  ) {
    capturedGroqOptions = opts;
    this.chat = { completions: { create: () => groqCreateImpl() } };
  });
  return { default: OpenAIMock, APIError };
});

// ---- @google/genai (Gemini) mock ---------------------------------------

let capturedGeminiOptions:
  | { apiKey?: string; httpOptions?: { timeout?: number } }
  | undefined;
let geminiCreateImpl: () => Promise<unknown>;

vi.mock("@google/genai", () => {
  class ApiError extends Error {
    status?: number;
    constructor(opts: { message: string; status?: number }) {
      super(opts.message);
      this.status = opts.status;
    }
  }
  const GoogleGenAIMock = vi.fn().mockImplementation(function (
    this: { models: { generateContent: () => Promise<unknown>; generateContentStream: () => Promise<unknown> } },
    opts: { apiKey?: string; httpOptions?: { timeout?: number } },
  ) {
    capturedGeminiOptions = opts;
    this.models = {
      generateContent: () => geminiCreateImpl(),
      generateContentStream: () => geminiCreateImpl(),
    };
  });
  return {
    GoogleGenAI: GoogleGenAIMock,
    ApiError,
    ThinkingLevel: { MINIMAL: "MINIMAL" },
  };
});

/**
 * Mimics an unbounded, hung HTTP call: it only ever settles if it sees a
 * positive numeric timeout from the real client-construction code (the value
 * the provider under test actually configured) — otherwise it hangs exactly
 * like the SDK's own pre-fix default did, so a regression that drops the
 * timeout option makes this genuinely hang rather than quietly pass.
 */
function createHangingCompletion(
  getTimeout: () => number | undefined,
  rejectWith: (message: string) => unknown,
) {
  return () =>
    new Promise((_, reject) => {
      const timeout = getTimeout();
      if (typeof timeout === "number" && timeout > 0) {
        setTimeout(() => {
          reject(rejectWith("Request timed out. This is a client-side timeout."));
        }, timeout);
      }
      // else: deliberately never settles.
    });
}

const REQUEST = { systemPrompt: "", turns: [{ role: "user" as const, content: "hi" }], maxOutputTokens: 10 };

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  capturedGroqOptions = undefined;
  capturedGeminiOptions = undefined;
  // Short, non-secret-shaped placeholders — deliberately under the 8-char
  // floor .gitleaks.toml's talentrah-hardcoded-credential rule matches on,
  // so a dummy test fixture doesn't trip the same scanner a real leaked key
  // is meant to. Never sent anywhere real: both SDK clients are mocked above.
  process.env.GROQ_API_KEY = "stub";
  process.env.GEMINI_API_KEY = "stub";
});

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...ORIGINAL_ENV };
});

describe("GroqProvider client timeout", () => {
  it("constructs the OpenAI client with a bounded, sane timeout", async () => {
    const { GroqProvider, GROQ_CLIENT_TIMEOUT_MS } = await import("@/lib/llm/groq-provider");
    groqCreateImpl = () => Promise.resolve({ choices: [{ message: { content: "ok" } }], usage: undefined });

    await new GroqProvider().generateWithUsage(REQUEST);

    expect(capturedGroqOptions?.timeout).toBe(GROQ_CLIENT_TIMEOUT_MS);
    // Bounded and sane — not zero/undefined, and well under a serverless
    // function's realistic execution budget.
    expect(capturedGroqOptions?.timeout).toBeGreaterThan(0);
    expect(capturedGroqOptions?.timeout).toBeLessThanOrEqual(60_000);
  });

  it("aborts a hung completion at the configured timeout, not never", async () => {
    vi.useFakeTimers();
    const { GroqProvider, GROQ_CLIENT_TIMEOUT_MS } = await import("@/lib/llm/groq-provider");
    const { APIError } = await import("openai");
    groqCreateImpl = createHangingCompletion(
      () => capturedGroqOptions?.timeout,
      (message) => new APIError(undefined, undefined, message, undefined),
    );

    const promise = new GroqProvider().generateWithUsage(REQUEST);
    let settled = false;
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );

    // Still hanging just short of the configured timeout.
    await vi.advanceTimersByTimeAsync(GROQ_CLIENT_TIMEOUT_MS - 1000);
    expect(settled).toBe(false);

    // Aborts right at the configured timeout.
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(true);
    await expect(promise).rejects.toMatchObject({ provider: "groq", kind: "unknown" });
  });
});

describe("GeminiProvider client timeout", () => {
  it("constructs the GoogleGenAI client with a bounded, sane timeout", async () => {
    const { GeminiProvider, GEMINI_CLIENT_TIMEOUT_MS } = await import("@/lib/llm/gemini-provider");
    geminiCreateImpl = () => Promise.resolve({ text: "ok", usageMetadata: undefined });

    await new GeminiProvider().generateWithUsage(REQUEST);

    expect(capturedGeminiOptions?.httpOptions?.timeout).toBe(GEMINI_CLIENT_TIMEOUT_MS);
    expect(capturedGeminiOptions?.httpOptions?.timeout).toBeGreaterThan(0);
    expect(capturedGeminiOptions?.httpOptions?.timeout).toBeLessThanOrEqual(60_000);
  });

  it("aborts a hung generateContent call at the configured timeout, not never", async () => {
    vi.useFakeTimers();
    const { GeminiProvider, GEMINI_CLIENT_TIMEOUT_MS } = await import("@/lib/llm/gemini-provider");
    // The real SDK surfaces a client-side abort as a raw DOMException
    // (AbortError), NOT its own ApiError — see this fix's PR description /
    // gemini-provider.ts's own comment for how that was confirmed against
    // the SDK's source. GeminiProvider's catch block must still turn that
    // into a normal LLMProviderError instead of leaking it.
    geminiCreateImpl = createHangingCompletion(
      () => capturedGeminiOptions?.httpOptions?.timeout,
      (message) => new DOMException(message, "AbortError"),
    );

    const promise = new GeminiProvider().generateWithUsage(REQUEST);
    let settled = false;
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );

    await vi.advanceTimersByTimeAsync(GEMINI_CLIENT_TIMEOUT_MS - 1000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(true);
    await expect(promise).rejects.toMatchObject({ provider: "gemini", kind: "unknown" });
  });
});
