/**
 * A1 (S3-66): the streaming providers report the token counts the provider gave them, so the farah_call log line can carry real numbers (until now
 * nothing recorded tokens anywhere, and the per-message cost against Groq's per-minute and daily caps was only an estimate). `onUsage` is called
 * once when the stream ends, only if the provider reported counts. Groq's final chunk carries them either as `usage` or as `x_groq.usage`; both
 * are read, and neither is required: a stream with no counts calls nothing. Exercised through the real `openai` package with only `fetch` stubbed,
 * like tests/llm/stream-finish-reason.test.ts. `onUsage` is passed through a loose cast (a typed option would stop `tsc` before the tests run).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroqProvider } from "@/lib/llm/groq-provider";

type Usage = { inputTokens: number; outputTokens: number; totalTokens: number; reasoningTokens: number | null };
const TEST_KEY = "gsk_test_usage_not_real";
let savedKey: string | undefined;

const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null, extra: Record<string, unknown> = {}) => ({
  id: "chatcmpl-usage-test",
  object: "chat.completion.chunk",
  choices: [{ index: 0, delta, finish_reason }],
  ...extra,
});
const sse = (chunks: unknown[]) =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });

beforeEach(() => {
  savedKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = TEST_KEY;
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = savedKey;
});

async function run(chunks: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async () => sse(chunks)));
  const usages: Usage[] = [];
  const options = { systemPrompt: "s", turns: [{ role: "user" as const, content: "q" }], maxOutputTokens: 50, onUsage: (u: Usage) => usages.push(u) };
  let text = "";
  for await (const piece of new GroqProvider().generateTextStream(options as never)) text += piece;
  return { text, usages };
}

describe("Groq stream usage", () => {
  it("reads usage from x_groq.usage on the final chunk (how Groq reports it)", async () => {
    const { text, usages } = await run([
      chunk({ content: "Hello" }),
      chunk({}, "stop", { x_groq: { usage: { prompt_tokens: 2400, completion_tokens: 480, total_tokens: 2880, completion_tokens_details: { reasoning_tokens: 90 } } } }),
    ]);
    expect(text).toBe("Hello");
    expect(usages).toEqual([{ inputTokens: 2400, outputTokens: 480, totalTokens: 2880, reasoningTokens: 90 }]);
  });

  it("reads usage from a top-level usage object too (OpenAI-style)", async () => {
    const { usages } = await run([chunk({ content: "Hi" }), chunk({}, "stop"), { id: "u", object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }]);
    expect(usages).toEqual([{ inputTokens: 10, outputTokens: 5, totalTokens: 15, reasoningTokens: null }]);
  });

  it("calls nothing when the provider reported no counts, and the stream is unaffected", async () => {
    const { text, usages } = await run([chunk({ content: "Hi" }), chunk({}, "stop")]);
    expect(text).toBe("Hi");
    expect(usages).toEqual([]);
  });

  it("ignores a malformed usage object rather than reporting garbage", async () => {
    const { usages } = await run([chunk({ content: "Hi" }), chunk({}, "stop", { x_groq: { usage: { prompt_tokens: "lots", completion_tokens: null } } })]);
    expect(usages).toEqual([]);
  });
});
