/**
 * send-483 — our Groq client, driven through the REAL `openai` package with only
 * the network mocked.
 *
 * WHY THIS EXISTS. Production's LLM provider is Groq, reached through the `openai`
 * SDK with a Groq `baseURL` (src/lib/llm/groq-provider.ts, and the isolated JD
 * extraction client in src/lib/llm/jd-extraction/groq-provider.ts). Every existing
 * test of those classes (provider-timeout.test.ts, jd-extraction-provider.test.ts)
 * replaces the `openai` MODULE with a stand-in, and provider-timeout's own header
 * says it covers "not either SDK's real HTTP/retry internals". So when #589 bumped
 * `openai` 7.15.0 -> 7.23.0 (whose changelog includes "preserve model choices and
 * improve request handling"), CI could not say whether our requests still looked
 * the same or our responses and errors still parsed. This file can.
 *
 * HOW. Only `fetch` is stubbed (`vi.stubGlobal`); the SDK is the installed one.
 * `getGroqClient()` builds a new client on every call and the SDK reads `fetch`
 * when it is constructed, so the stub is what the SDK uses. Nothing here mocks
 * `openai`. The first test proves that: the request carries the SDK's own
 * User-Agent.
 *
 * WHAT IT PINS:
 *   - the request: URL, method, bearer key, model, messages (system prompt with
 *     the JSON schema spelled out, then the turns), max_tokens, reasoning_effort,
 *     response_format, and `stream: true` only when streaming;
 *   - the response: text, and usage mapped field for field (input, output, total,
 *     reasoning tokens);
 *   - errors: 429 -> rate_limit, 401 -> auth, other -> unknown, each as the SDK
 *     really reports them, including that Groq's own "Please try again in 1m18.192s"
 *     survives into the message farahRateLimitMessage parses;
 *   - the SDK's default retry of a 429 (a change to it changes production behaviour);
 *   - streaming, which is what actually carries Farah's replies in production:
 *     only `delta.content` is yielded, never `delta.reasoning`.
 *
 * NOT COVERED: a real Groq server (no key, no network), timeouts, and any model's
 * actual output. The response bodies below are written to the OpenAI chat-
 * completions shape Groq returns; they are the test's assumption, not a recording.
 *
 * No database, no network, no real key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroqProvider, GROQ_MODEL } from "@/lib/llm/groq-provider";
import { GroqJdExtractionProvider } from "@/lib/llm/jd-extraction/groq-provider";
import { LLMProviderError } from "@/lib/llm/errors";
import { farahRateLimitMessage } from "@/lib/farah/rate-limit-message";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const TEST_KEY = "gsk_test_wire_key_not_real";
const TEST_JD_KEY = "gsk_test_jd_wire_key_not_real";

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
}

let fetchMock: ReturnType<typeof vi.fn>;
let captured: Captured[];
const savedEnv: Record<string, string | undefined> = {};

function completion(content: string | null, usage: Record<string, unknown> | null = null) {
  return {
    id: "chatcmpl-wire-test",
    object: "chat.completion",
    created: 1790000000,
    model: GROQ_MODEL,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    ...(usage ? { usage } : {}),
  };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** An error the way Groq sends one. `x-should-retry: false` keeps the SDK from retrying so a test sees one call. */
function groqError(status: number, message: string, type = "error"): Response {
  return json(
    { error: { message, type, code: status === 429 ? "rate_limit_exceeded" : null } },
    { status, headers: { "content-type": "application/json", "x-should-retry": "false" } },
  );
}

function sse(chunks: unknown[]): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const delta = (d: Record<string, unknown>) => ({
  id: "chatcmpl-wire-test",
  object: "chat.completion.chunk",
  choices: [{ index: 0, delta: d, finish_reason: null }],
});

/** Install a fetch that records each request and answers with `respond(callIndex)`. */
function stubNetwork(respond: (call: number) => Response | Promise<Response>) {
  captured = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    captured.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    return respond(captured.length - 1);
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  for (const k of ["GROQ_API_KEY", "JD_EXTRACTION_GROQ_API_KEY", "JD_EXTRACTION_GROQ_MODEL"]) savedEnv[k] = process.env[k];
  process.env.GROQ_API_KEY = TEST_KEY;
  process.env.JD_EXTRACTION_GROQ_API_KEY = TEST_JD_KEY;
  delete process.env.JD_EXTRACTION_GROQ_MODEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const SCHEMA = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };

describe("GroqProvider.generateWithUsage over the real openai package", () => {
  it("CONTROL: the request comes from the real SDK (its own User-Agent), not a stand-in", async () => {
    stubNetwork(() => json(completion("hello")));
    await new GroqProvider().generateWithUsage({ systemPrompt: "s", turns: [{ role: "user", content: "hi" }], maxOutputTokens: 50 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured[0]!.headers.get("user-agent") ?? "").toMatch(/^OpenAI\/JS /);
  });

  it("sends the right URL, key, model, messages and options", async () => {
    stubNetwork(() => json(completion('{"ok":true}')));
    await new GroqProvider().generateWithUsage({
      systemPrompt: "You are Farah.",
      turns: [
        { role: "user", content: "First question" },
        { role: "assistant", content: "First answer" },
        { role: "user", content: "Second question" },
      ],
      maxOutputTokens: 1234,
      jsonSchema: SCHEMA,
    });

    const req = captured[0]!;
    expect(req.url).toBe(GROQ_CHAT_URL);
    expect(req.method).toBe("POST");
    expect(req.headers.get("authorization")).toBe(`Bearer ${TEST_KEY}`);
    expect(req.headers.get("content-type")).toMatch(/application\/json/);

    expect(req.body.model).toBe("openai/gpt-oss-120b");
    expect(req.body.max_tokens).toBe(1234);
    expect(req.body.reasoning_effort).toBe("low");
    expect(req.body.response_format).toEqual({ type: "json_object" });
    expect(req.body).not.toHaveProperty("stream");

    const messages = req.body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[0]!.content.startsWith("You are Farah.")).toBe(true);
    expect(messages[0]!.content).toContain("Respond with ONLY a single JSON object matching this JSON Schema");
    expect(messages[0]!.content).toContain(JSON.stringify(SCHEMA));
    expect(messages.slice(1).map((m) => m.content)).toEqual(["First question", "First answer", "Second question"]);
  });

  it("without a schema: no response_format, and the system prompt is sent unchanged", async () => {
    stubNetwork(() => json(completion("plain")));
    await new GroqProvider().generateWithUsage({ systemPrompt: "Just chat.", turns: [{ role: "user", content: "hi" }], maxOutputTokens: 10 });
    expect(captured[0]!.body).not.toHaveProperty("response_format");
    expect((captured[0]!.body.messages as { content: string }[])[0]!.content).toBe("Just chat.");
  });

  it("returns the text and maps usage field for field, reasoning tokens included", async () => {
    stubNetwork(() =>
      json(completion("the answer", { prompt_tokens: 55, completion_tokens: 23, total_tokens: 78, completion_tokens_details: { reasoning_tokens: 9 } })),
    );
    const result = await new GroqProvider().generateWithUsage({ systemPrompt: "s", turns: [{ role: "user", content: "q" }], maxOutputTokens: 50 });
    expect(result.text).toBe("the answer");
    expect(result.usage).toEqual({ inputTokens: 55, outputTokens: 23, totalTokens: 78, reasoningTokens: 9 });
  });

  it("usage is null when the response carries none, and reasoning tokens are null when absent", async () => {
    stubNetwork(() => json(completion("no usage")));
    const a = await new GroqProvider().generateWithUsage({ systemPrompt: "s", turns: [{ role: "user", content: "q" }], maxOutputTokens: 5 });
    expect(a.usage).toBeNull();

    stubNetwork(() => json(completion("usage, no details", { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 })));
    const b = await new GroqProvider().generateWithUsage({ systemPrompt: "s", turns: [{ role: "user", content: "q" }], maxOutputTokens: 5 });
    expect(b.usage).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3, reasoningTokens: null });
  });

  it("an empty completion is an 'unknown' LLMProviderError, not an empty string", async () => {
    stubNetwork(() => json(completion(null)));
    const err = await new GroqProvider()
      .generateWithUsage({ systemPrompt: "s", turns: [{ role: "user", content: "q" }], maxOutputTokens: 5 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LLMProviderError);
    expect((err as LLMProviderError).kind).toBe("unknown");
    expect((err as LLMProviderError).message).toContain("empty response");
  });
});

describe("GroqProvider errors, as the real SDK reports them", () => {
  const TPD_MESSAGE =
    "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): " +
    "Limit 200000, Used 198178, Requested 2003. Please try again in 1m18.192s.";

  it("429 -> rate_limit, and Groq's own wait time survives into what farahRateLimitMessage parses", async () => {
    stubNetwork(() => groqError(429, TPD_MESSAGE, "tokens"));
    const err = (await new GroqProvider()
      .generateWithUsage({ systemPrompt: "s", turns: [{ role: "user", content: "q" }], maxOutputTokens: 5 })
      .catch((e: unknown) => e)) as LLMProviderError;

    expect(err).toBeInstanceOf(LLMProviderError);
    expect(err.provider).toBe("groq");
    expect(err.kind).toBe("rate_limit");
    expect(err.message).toContain("tokens per day (TPD)");
    expect(err.message).toContain("Please try again in 1m18.192s");
    // The consumer that matters: 78.192 s rounds to "about 1 minute" in Farah's copy.
    expect(farahRateLimitMessage(err.message)).toBe("Farah's hit her limit for right now — try again in about 1 minute.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("401 -> auth and 403 -> auth", async () => {
    for (const status of [401, 403]) {
      stubNetwork(() => groqError(status, "Invalid API Key"));
      const err = (await new GroqProvider()
        .generateWithUsage({ systemPrompt: "s", turns: [{ role: "user", content: "q" }], maxOutputTokens: 5 })
        .catch((e: unknown) => e)) as LLMProviderError;
      expect(err.kind, `status ${status}`).toBe("auth");
    }
  });

  it("500 and 400 -> unknown (so generateWithFailover does NOT fail over on them)", async () => {
    for (const status of [500, 400]) {
      stubNetwork(() => groqError(status, "Failed to generate JSON"));
      const err = (await new GroqProvider()
        .generateWithUsage({ systemPrompt: "s", turns: [{ role: "user", content: "q" }], maxOutputTokens: 5 })
        .catch((e: unknown) => e)) as LLMProviderError;
      expect(err.kind, `status ${status}`).toBe("unknown");
      expect(err.message).toContain("Failed to generate JSON");
    }
  });

  it("the SDK retries a 429 by default and the provider returns the eventual success (pins production's retry behaviour)", async () => {
    stubNetwork((call) =>
      call === 0
        ? json({ error: { message: "slow down", type: "error" } }, { status: 429, headers: { "content-type": "application/json", "retry-after-ms": "1" } })
        : json(completion("recovered")),
    );
    const result = await new GroqProvider().generateWithUsage({ systemPrompt: "s", turns: [{ role: "user", content: "q" }], maxOutputTokens: 5 });
    expect(result.text).toBe("recovered");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("GroqProvider.generateTextStream — what actually streams Farah's replies", () => {
  it("sends stream: true with the same model and messages, and yields only delta.content, in order", async () => {
    stubNetwork(() =>
      sse([
        delta({ role: "assistant", content: "" }),
        delta({ reasoning: "thinking about the question" }),
        delta({ content: "Hel" }),
        delta({ content: "lo, " }),
        delta({ reasoning: "more thinking" }),
        delta({ content: "Ada." }),
      ]),
    );
    const out: string[] = [];
    for await (const piece of new GroqProvider().generateTextStream({
      systemPrompt: "You are Farah.",
      turns: [{ role: "user", content: "hi" }],
      maxOutputTokens: 200,
    })) {
      out.push(piece);
    }

    expect(out).toEqual(["Hel", "lo, ", "Ada."]);
    const req = captured[0]!;
    expect(req.url).toBe(GROQ_CHAT_URL);
    expect(req.body.stream).toBe(true);
    expect(req.body.model).toBe("openai/gpt-oss-120b");
    expect(req.body.reasoning_effort).toBe("low");
    expect((req.body.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("a 429 when the stream is opened is a rate_limit LLMProviderError", async () => {
    stubNetwork(() => groqError(429, "Rate limit reached ... Please try again in 2m0s."));
    const it = new GroqProvider()
      .generateTextStream({ systemPrompt: "s", turns: [{ role: "user", content: "q" }], maxOutputTokens: 5 })
      [Symbol.asyncIterator]();
    const err = (await it.next().catch((e: unknown) => e)) as LLMProviderError;
    expect(err).toBeInstanceOf(LLMProviderError);
    expect(err.kind).toBe("rate_limit");
  });
});

describe("GroqJdExtractionProvider over the real openai package", () => {
  it("sends its own key, its own (smaller) model and a JSON-mode request, and parses the skills", async () => {
    stubNetwork(() =>
      json(
        completion('{"skills":["stata","survey design"]}', {
          prompt_tokens: 410,
          completion_tokens: 30,
          total_tokens: 440,
          completion_tokens_details: { reasoning_tokens: 12 },
        }),
      ),
    );
    const result = await new GroqJdExtractionProvider().extractSkills("We need someone who knows Stata and survey design.");

    const req = captured[0]!;
    expect(req.url).toBe(GROQ_CHAT_URL);
    expect(req.headers.get("authorization")).toBe(`Bearer ${TEST_JD_KEY}`);
    expect(req.body.model).toBe("openai/gpt-oss-20b");
    expect(req.body.max_tokens).toBe(300);
    expect(req.body.reasoning_effort).toBe("low");
    expect(req.body.response_format).toEqual({ type: "json_object" });
    const messages = req.body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(messages[1]!.content).toBe("We need someone who knows Stata and survey design.");

    expect(result.skills).toEqual(["stata", "survey design"]);
    expect(result.usage).toEqual({ inputTokens: 410, outputTokens: 30, totalTokens: 440, reasoningTokens: 12 });
  });

  it("a 429 is a rate_limit LLMProviderError here too", async () => {
    stubNetwork(() => groqError(429, "Rate limit reached ... Please try again in 30s."));
    const err = (await new GroqJdExtractionProvider().extractSkills("jd").catch((e: unknown) => e)) as LLMProviderError;
    expect(err).toBeInstanceOf(LLMProviderError);
    expect(err.kind).toBe("rate_limit");
  });
});
