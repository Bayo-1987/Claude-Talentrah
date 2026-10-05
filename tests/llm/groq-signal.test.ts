/**
 * The Groq provider hands an abort signal to the HTTP request. Exercised through the real `openai` package with only `fetch` stubbed, like tests/llm/stream-usage.test.ts. `signal` is passed through a loose
 * cast: a typed option would stop `tsc` before the tests run.
 *
 *   A. the signal given to generateTextStream reaches fetch (aborting ours aborts the request's);
 *   B. a mid-stream abort ends the stream with an error that is NOT a rate limit (so it can never trigger failover to the other provider);
 *   C. a signal that is already aborted ends the call without yielding anything.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroqProvider } from "@/lib/llm/groq-provider";
import { LLMProviderError } from "@/lib/llm/errors";

const TEST_KEY = "gsk_test_signal_not_real";
let savedKey: string | undefined;
beforeEach(() => {
  savedKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = TEST_KEY;
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = savedKey;
});

const line = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
const options = (signal: AbortSignal) => ({ systemPrompt: "s", turns: [{ role: "user" as const, content: "q" }], maxOutputTokens: 50, signal }) as never;

/** A response whose body yields one chunk, then waits until the request's signal fires and errors the way an aborted fetch body does. */
function streamThatWaitsForAbort(init: RequestInit | undefined) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(line({ content: "first" })));
      init?.signal?.addEventListener("abort", () => controller.error(new DOMException("The operation was aborted.", "AbortError")), { once: true });
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("Groq provider and the abort signal", () => {
  it("A. the signal reaches the HTTP request: aborting ours aborts the one fetch sees", async () => {
    let fetchSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      fetchSignal = init?.signal;
      return new Response(line({ content: "Hi" }) + line({}, "stop") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
    }));
    const controller = new AbortController();
    for await (const _piece of new GroqProvider().generateTextStream(options(controller.signal))) void _piece;
    expect(fetchSignal, "fetch received no signal").toBeTruthy();
    expect(fetchSignal!.aborted).toBe(false);
    controller.abort();
    expect(fetchSignal!.aborted, "aborting the caller's signal did not abort the request").toBe(true);
  }, 3000);

  it("B. a mid-stream abort ends the stream with an error that is not a rate limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => streamThatWaitsForAbort(init)));
    const controller = new AbortController();
    const seen: string[] = [];
    let caught: unknown;
    try {
      for await (const piece of new GroqProvider().generateTextStream(options(controller.signal))) {
        seen.push(piece);
        controller.abort();
      }
    } catch (err) {
      caught = err;
    }
    expect(seen).toEqual(["first"]);
    expect(caught, "the stream did not end with an error after the abort").toBeInstanceOf(LLMProviderError);
    expect((caught as LLMProviderError).kind).not.toBe("rate_limit");
  }, 3000);

  it("C. a signal that is already aborted ends the call without yielding", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      return new Response(line({ content: "should not be read" }) + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
    }));
    const controller = new AbortController();
    controller.abort();
    const seen: string[] = [];
    let caught: unknown;
    try {
      for await (const piece of new GroqProvider().generateTextStream(options(controller.signal))) seen.push(piece);
    } catch (err) {
      caught = err;
    }
    expect(seen).toEqual([]);
    expect(caught).toBeInstanceOf(LLMProviderError);
  }, 3000);
});
