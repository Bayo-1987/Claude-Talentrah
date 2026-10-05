/**
 * The streaming failover can be told, before it switches to the fallback provider, whether the fallback may be used (`allowFallback`). The question is asked ONLY at the moment the primary has answered
 * rate-limited before its first chunk (the one case the fallback exists for); if the answer is no, or the question itself cannot be answered, the fallback is not called and the stream ends with a
 * FallbackDeclinedError. With no `allowFallback` the behaviour is exactly what it was.
 *
 * The two providers are fakes at the module boundary; LLM_PROVIDER=groq makes Gemini the fallback, as in production.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
let primaryBehaviour: "rate_limit" | "unknown" | "chunk-then-rate-limit" | "ok" = "rate_limit";

vi.mock("@/lib/llm/groq-provider", () => ({ GroqProvider: class { name = "groq"; model = "fake-primary"; } }));
vi.mock("@/lib/llm/gemini-provider", () => ({ GeminiProvider: class { name = "gemini"; model = "fake-fallback"; } }));

let failover: typeof import("@/lib/llm");
let errors: typeof import("@/lib/llm/errors");
beforeAll(async () => {
  process.env.LLM_PROVIDER = "groq";
  failover = await import("@/lib/llm");
  errors = await import("@/lib/llm/errors");
});
beforeEach(() => {
  calls.length = 0;
  primaryBehaviour = "rate_limit";
});

/** `call` as the chat client builds it: a different generator per provider. */
function call(provider: { name: string }): AsyncGenerator<string> {
  calls.push(provider.name);
  return (async function* () {
    if (provider.name === "gemini") {
      yield "fallback reply";
      return;
    }
    if (primaryBehaviour === "rate_limit") throw new errors.LLMProviderError("groq", "rate_limit", "Please try again in 1m0s.");
    if (primaryBehaviour === "unknown") throw new errors.LLMProviderError("groq", "unknown", "boom");
    if (primaryBehaviour === "chunk-then-rate-limit") {
      yield "first";
      throw new errors.LLMProviderError("groq", "rate_limit", "mid-stream");
    }
    yield "primary reply";
  })();
}
async function drain(gen: AsyncGenerator<string>): Promise<{ text: string; error: unknown }> {
  let text = "";
  try {
    for await (const c of gen) text += c;
  } catch (error) {
    return { text, error };
  }
  return { text, error: undefined };
}
const gen = (allowFallback?: () => Promise<boolean> | boolean) => failover.generateChatStreamWithFailover(call as never, undefined, allowFallback ? ({ allowFallback } as never) : undefined);

describe("allowFallback: asked only when the fallback is about to be used", () => {
  it("allowed: the fallback serves the reply, and was asked exactly once", async () => {
    const allow = vi.fn().mockResolvedValue(true);
    const r = await drain(gen(allow));
    expect(r).toEqual({ text: "fallback reply", error: undefined });
    expect(allow).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["groq", "gemini"]);
  });

  it("declined: the fallback is NOT called and the stream ends with a FallbackDeclinedError", async () => {
    const allow = vi.fn().mockResolvedValue(false);
    const r = await drain(gen(allow));
    expect(r.text).toBe("");
    expect(r.error).toBeInstanceOf(errors.FallbackDeclinedError);
    expect(calls).toEqual(["groq"]);
  });

  it("when the question cannot be answered (it throws), the fallback is NOT called: fail closed", async () => {
    const allow = vi.fn().mockRejectedValue(new Error("counter unreadable"));
    const r = await drain(gen(allow));
    expect(r.error).toBeInstanceOf(errors.FallbackDeclinedError);
    expect(calls).toEqual(["groq"]);
  });

  it("no allowFallback given: unchanged, the fallback serves", async () => {
    const r = await drain(gen());
    expect(r).toEqual({ text: "fallback reply", error: undefined });
    expect(calls).toEqual(["groq", "gemini"]);
  });

  it("an error that is not a rate limit propagates as before, and the question is never asked", async () => {
    primaryBehaviour = "unknown";
    const allow = vi.fn().mockResolvedValue(true);
    const r = await drain(gen(allow));
    expect(r.error).toBeInstanceOf(errors.LLMProviderError);
    expect(allow).not.toHaveBeenCalled();
    expect(calls).toEqual(["groq"]);
  });

  it("a rate limit AFTER the first chunk is not a failover case: it propagates, and the question is never asked", async () => {
    primaryBehaviour = "chunk-then-rate-limit";
    const allow = vi.fn().mockResolvedValue(true);
    const r = await drain(gen(allow));
    expect(r.text).toBe("first");
    expect(r.error).toBeInstanceOf(errors.LLMProviderError);
    expect(allow).not.toHaveBeenCalled();
  });

  it("a primary that works never asks", async () => {
    primaryBehaviour = "ok";
    const allow = vi.fn().mockResolvedValue(true);
    expect(await drain(gen(allow))).toEqual({ text: "primary reply", error: undefined });
    expect(allow).not.toHaveBeenCalled();
  });
});
