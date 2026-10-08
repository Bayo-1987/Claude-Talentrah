/**
 * The Gemini provider and the abort signal (the counterpart of tests/llm/groq-signal.test.ts; Gemini is the failover target and a primary option, and had no abort test).
 * The SDK is mocked at the module boundary (like tests/llm/provider-timeout.test.ts), with the SDK's real `ApiError` so the provider's own error mapping is what runs.
 *
 *   A. the signal given to generateTextStream reaches the SDK call as `config.abortSignal`; with no signal the key is absent;
 *   B. an abort mid-stream ends the stream with an LLMProviderError that is NOT a rate limit (so it can never trigger failover), whether the SDK ends the stream quietly
 *      or throws an AbortError, and the partial text is never reported as a finished reply (no onFinish, no onUsage);
 *   C. a provider failure with a LIVE signal surfaces as itself (500 -> unknown with its own message, 429 -> rate_limit, 401 -> auth), never as "cancelled",
 *      and a reply that completes with a live signal is still a finished reply (onFinish and onUsage are called).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let streamImpl: (config: Record<string, unknown>) => Promise<AsyncGenerator<Record<string, unknown>>>;
let capturedConfig: Record<string, unknown> | undefined;

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  class GoogleGenAI {
    models = {
      generateContentStream: (args: { config: Record<string, unknown> }) => {
        capturedConfig = args.config;
        return streamImpl(args.config);
      },
    };
  }
  return { ...actual, GoogleGenAI };
});

const { GeminiProvider } = await import("@/lib/llm/gemini-provider");
const { LLMProviderError } = await import("@/lib/llm/errors");
const { ApiError } = await import("@google/genai");

const CANCELLED = "The request was cancelled.";
const FINISHED_CHUNK = (text: string) => ({
  text,
  candidates: [{ finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
});
const options = (extra: Record<string, unknown> = {}) => ({ systemPrompt: "s", turns: [{ role: "user" as const, content: "q" }], maxOutputTokens: 50, ...extra }) as never;
const apiError = (status: number, message: string) => new ApiError({ status, message });

async function collect(provider: InstanceType<typeof GeminiProvider>, opts: never) {
  const seen: string[] = [];
  let caught: unknown;
  try {
    for await (const piece of provider.generateTextStream(opts)) seen.push(piece);
  } catch (err) {
    caught = err;
  }
  return { seen, caught };
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-gemini-key-not-real";
  capturedConfig = undefined;
});

describe("A. the signal reaches the SDK call", () => {
  it("passes the caller's signal as config.abortSignal", async () => {
    streamImpl = async function* () {
      yield FINISHED_CHUNK("Hi");
    } as never;
    const controller = new AbortController();
    await collect(new GeminiProvider(), options({ signal: controller.signal }));
    expect(capturedConfig?.abortSignal, "the SDK call received no signal").toBe(controller.signal);
  });
  it("adds no abortSignal key when the caller gave no signal", async () => {
    streamImpl = async function* () {
      yield FINISHED_CHUNK("Hi");
    } as never;
    await collect(new GeminiProvider(), options());
    expect(capturedConfig).toBeDefined();
    expect("abortSignal" in capturedConfig!).toBe(false);
  });
});

describe("B. an abort mid-stream is an error that is not a rate limit, and not a finished reply", () => {
  it("the SDK ends the stream QUIETLY after the abort: the stream still throws, and nothing is reported finished", async () => {
    const controller = new AbortController();
    streamImpl = (async function* () {
      yield FINISHED_CHUNK("first");
      controller.abort();
    }) as never;
    const onFinish = vi.fn();
    const onUsage = vi.fn();
    const { seen, caught } = await collect(new GeminiProvider(), options({ signal: controller.signal, onFinish, onUsage }));
    expect(seen).toEqual(["first"]);
    expect(caught, "a quietly ended aborted stream read as a finished reply").toBeInstanceOf(LLMProviderError);
    expect((caught as Error).message).toContain(CANCELLED);
    expect((caught as InstanceType<typeof LLMProviderError>).kind).not.toBe("rate_limit");
    expect(onFinish).not.toHaveBeenCalled();
    expect(onUsage).not.toHaveBeenCalled();
  });
  it("the SDK throws an AbortError after the abort: an LLMProviderError that is not a rate limit", async () => {
    const controller = new AbortController();
    streamImpl = (async function* () {
      yield { text: "first" };
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as never;
    const onFinish = vi.fn();
    const { seen, caught } = await collect(new GeminiProvider(), options({ signal: controller.signal, onFinish }));
    expect(seen).toEqual(["first"]);
    expect(caught).toBeInstanceOf(LLMProviderError);
    expect((caught as InstanceType<typeof LLMProviderError>).kind).toBe("unknown");
    expect(onFinish).not.toHaveBeenCalled();
  });
  it("a signal that is already aborted before the call: nothing is yielded and the stream ends in an error, not a finished reply", async () => {
    const controller = new AbortController();
    controller.abort();
    streamImpl = (async function* () {
      yield FINISHED_CHUNK("should not be read as a finished reply");
    }) as never;
    const onFinish = vi.fn();
    const { caught } = await collect(new GeminiProvider(), options({ signal: controller.signal, onFinish }));
    expect(caught).toBeInstanceOf(LLMProviderError);
    expect((caught as InstanceType<typeof LLMProviderError>).kind).not.toBe("rate_limit");
    expect(onFinish).not.toHaveBeenCalled();
  });
});

describe("C. a provider failure with a live signal is that failure, never 'cancelled'", () => {
  it.each([
    [500, "unknown", "internal error at the provider"],
    [429, "rate_limit", "quota exceeded"],
    [401, "auth", "bad key"],
  ])("a %i from the SDK call surfaces as kind %s with its own message", async (status, kind, message) => {
    const controller = new AbortController();
    streamImpl = async () => {
      throw apiError(status, message);
    };
    const { seen, caught } = await collect(new GeminiProvider(), options({ signal: controller.signal }));
    expect(seen).toEqual([]);
    expect(caught).toBeInstanceOf(LLMProviderError);
    expect((caught as InstanceType<typeof LLMProviderError>).kind).toBe(kind);
    expect((caught as Error).message).toContain(message);
    expect((caught as Error).message).not.toContain(CANCELLED);
  });
  it("a failure part-way through the stream (live signal) is that failure, not 'cancelled'", async () => {
    const controller = new AbortController();
    streamImpl = (async function* () {
      yield { text: "first" };
      throw apiError(500, "broke mid-stream");
    }) as never;
    const { seen, caught } = await collect(new GeminiProvider(), options({ signal: controller.signal }));
    expect(seen).toEqual(["first"]);
    expect((caught as Error).message).toContain("broke mid-stream");
    expect((caught as Error).message).not.toContain(CANCELLED);
  });
  it("a reply that completes with a live signal is a finished reply: onFinish and onUsage are called", async () => {
    const controller = new AbortController();
    streamImpl = (async function* () {
      yield FINISHED_CHUNK("all of it");
    }) as never;
    const onFinish = vi.fn();
    const onUsage = vi.fn();
    const { seen, caught } = await collect(new GeminiProvider(), options({ signal: controller.signal, onFinish, onUsage }));
    expect(caught).toBeUndefined();
    expect(seen).toEqual(["all of it"]);
    expect(onFinish).toHaveBeenCalledWith("stop");
    expect(onUsage).toHaveBeenCalledTimes(1);
  });
});
