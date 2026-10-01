/**
 * send-500 (PR C) — the streaming providers say WHY a reply stopped, so a length stop can be told from a clean one.
 *
 * `generateTextStream` yields text only, so until now nothing downstream could tell a reply cut off by
 * `max_tokens` from a finished one (the production incident this was found through: a charged reply that ends
 * mid-sentence). `LLMGenerateOptions.onFinish` is called once, when the stream ends, with a provider-neutral
 * reason. Groq (what production runs) and the stub are exercised through the real `openai` package with only
 * `fetch` stubbed, the same way tests/llm/groq-wire.test.ts does; Gemini's mapping is a pure function.
 *
 * Written before the option exists, so the option is passed through a loose cast (a typed `onFinish` would
 * stop `tsc`, which runs before the unit tests, and turn "behaviour missing" into "does not compile").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroqProvider } from "@/lib/llm/groq-provider";
import { StubProvider } from "@/lib/llm/stub-provider";

type FinishReason = "stop" | "length" | "other";
const TEST_KEY = "gsk_test_finish_reason_not_real";
let savedKey: string | undefined;

const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) => ({
  id: "chatcmpl-finish-test",
  object: "chat.completion.chunk",
  choices: [{ index: 0, delta, finish_reason }],
});
function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

beforeEach(() => {
  savedKey = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = TEST_KEY;
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (savedKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = savedKey;
});

async function drain(gen: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const piece of gen) out += piece;
  return out;
}

async function groqStream(chunks: unknown[]): Promise<{ text: string; reasons: FinishReason[] }> {
  vi.stubGlobal("fetch", vi.fn(async () => sse(chunks)));
  const reasons: FinishReason[] = [];
  const options = {
    systemPrompt: "s",
    turns: [{ role: "user" as const, content: "q" }],
    maxOutputTokens: 50,
    onFinish: (r: FinishReason) => reasons.push(r),
  };
  const text = await drain(new GroqProvider().generateTextStream(options as never));
  return { text, reasons };
}

describe("Groq stream", () => {
  it("reports 'length' when the model stopped because it hit max_tokens", async () => {
    const { text, reasons } = await groqStream([
      chunk({ role: "assistant", content: "" }),
      chunk({ content: "I'm a FinTech Product Manager with" }),
      chunk({}, "length"),
    ]);
    expect(text).toBe("I'm a FinTech Product Manager with");
    expect(reasons).toEqual(["length"]);
  });

  it("reports 'stop' for a finished reply", async () => {
    const { reasons } = await groqStream([chunk({ content: "Done." }), chunk({}, "stop")]);
    expect(reasons).toEqual(["stop"]);
  });

  it("reports 'other' for a reason it does not know (content_filter, tool_calls), never 'length'", async () => {
    const { reasons } = await groqStream([chunk({ content: "x" }), chunk({}, "content_filter")]);
    expect(reasons).toEqual(["other"]);
  });

  it("reports nothing when the stream carries no finish_reason at all (so the caller treats it as finished)", async () => {
    const { reasons } = await groqStream([chunk({ content: "x" })]);
    expect(reasons).toEqual([]);
  });

  it("still yields exactly the same text as before (the option changes nothing about the output)", async () => {
    const { text } = await groqStream([chunk({ content: "Hel" }), chunk({ content: "lo." }), chunk({}, "stop")]);
    expect(text).toBe("Hello.");
  });
});

describe("Gemini's mapping", () => {
  it("maps MAX_TOKENS to length, STOP to stop, anything else to other", async () => {
    const { mapGeminiFinishReason } = await import("@/lib/llm/gemini-provider").then((m) => m as unknown as {
      mapGeminiFinishReason: (r: string | undefined) => FinishReason | undefined;
    });
    expect(mapGeminiFinishReason("MAX_TOKENS")).toBe("length");
    expect(mapGeminiFinishReason("STOP")).toBe("stop");
    expect(mapGeminiFinishReason("SAFETY")).toBe("other");
    expect(mapGeminiFinishReason(undefined)).toBeUndefined();
  });
});

describe("stub provider (what the e2e suite runs against)", () => {
  async function stubReasons(message: string): Promise<FinishReason[]> {
    const reasons: FinishReason[] = [];
    const options = {
      systemPrompt: "s",
      turns: [{ role: "user" as const, content: message }],
      maxOutputTokens: 50,
      onFinish: (r: FinishReason) => reasons.push(r),
    };
    await drain(new StubProvider().generateTextStream(options as never));
    return reasons;
  }

  it("a message carrying the length trigger is reported as a length stop", async () => {
    expect(await stubReasons("please answer at length [stub:length]")).toEqual(["length"]);
  });

  it("an ordinary message finishes cleanly", async () => {
    expect(await stubReasons("hello")).toEqual(["stop"]);
  });
});
