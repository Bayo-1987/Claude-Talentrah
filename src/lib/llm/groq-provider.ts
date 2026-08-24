import "server-only";
import OpenAI, { APIError } from "openai";
import { LLMProviderError } from "./errors";
import type { LLMProvider, LLMGenerateOptions, LLMResult } from "./types";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * Large model, not a small/fast variant — quality-sensitive calls
 * (tailoring, gap analysis) need it. llama-3.3-70b-versatile (the
 * originally-specced default) no longer exists on Groq's API — confirmed
 * live via a 404 on this exact key, then cross-checked against
 * GET /openai/v1/models and https://console.groq.com/docs/models.
 * openai/gpt-oss-120b is the current largest general-purpose model in
 * Groq's catalog (120B params, 131K context, reasoning-capable) — the
 * actual current equivalent of what the 70B Llama model was meant to be.
 * Groq's catalog shifts; check https://console.groq.com/docs/models if
 * this 404s too.
 */
export const GROQ_MODEL = "openai/gpt-oss-120b";

/**
 * Same class of problem as Gemini's THINKING_CONFIG (src/lib/llm/gemini-
 * provider.ts): gpt-oss-120b reasons by default, and that reasoning draws
 * from the same max_tokens budget as the visible answer — measured live,
 * a moderate-complexity JSON-mode prompt spent 260 of 313 completion
 * tokens on invisible reasoning before ever reaching content. On the full
 * tailoring schema (much larger than that test) this reliably starved the
 * 4096-token budget before valid JSON was ever emitted, and Groq's strict
 * json_object mode returns a hard 400 ("Failed to generate JSON") rather
 * than the truncated text this codebase's own JSON.parse+retry can catch
 * — confirmed live, both with and without this fix. "low" is the minimum
 * this model accepts (no "none" — that's a Qwen-only value); dropped
 * reasoning tokens to 23 of 55 in the same test. Groq-specific — Gemini's
 * adapter has its own separate knob for the same underlying issue.
 */
const REASONING_EFFORT = "low" as const;

function getGroqClient(): OpenAI {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set — set LLM_PROVIDER=gemini or add the key.");
  }
  return new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });
}

export class GroqProvider implements LLMProvider {
  readonly name = "groq" as const;

  readonly model = GROQ_MODEL;

  /** Thin wrapper — one request path, generateWithUsage does the work. */
  async generateText(options: LLMGenerateOptions): Promise<string> {
    return (await this.generateWithUsage(options)).text;
  }

  async generateWithUsage({
    systemPrompt,
    turns,
    maxOutputTokens,
    jsonSchema,
  }: LLMGenerateOptions): Promise<LLMResult> {
    const client = getGroqClient();

    // Groq's OpenAI-compatible API only offers response_format:"json_object"
    // (enforces valid JSON, not a specific shape) — unlike Gemini's native
    // responseSchema, which does real constrained decoding. To get an
    // equivalent result, the schema is spelled out in the prompt itself
    // rather than silently dropped (build-prompt/task §3: "the Groq adapter
    // needs its own equivalent, not a broken passthrough").
    const systemContent = jsonSchema
      ? [
          systemPrompt,
          `Respond with ONLY a single JSON object matching this JSON Schema — no markdown fences, no commentary before or after:\n${JSON.stringify(jsonSchema)}`,
        ]
          .filter(Boolean)
          .join("\n\n")
      : systemPrompt;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...(systemContent ? [{ role: "system" as const, content: systemContent }] : []),
      ...turns.map((t) => ({ role: t.role, content: t.content })),
    ];

    try {
      const response = await client.chat.completions.create({
        model: GROQ_MODEL,
        messages,
        max_tokens: maxOutputTokens,
        reasoning_effort: REASONING_EFFORT,
        ...(jsonSchema ? { response_format: { type: "json_object" as const } } : {}),
      });

      const text = response.choices[0]?.message?.content;
      if (!text) {
        throw new LLMProviderError("groq", "unknown", "Groq returned an empty response.");
      }
      const u = response.usage;
      return {
        text,
        usage: u
          ? {
              inputTokens: u.prompt_tokens ?? 0,
              outputTokens: u.completion_tokens ?? 0,
              totalTokens: u.total_tokens ?? 0,
              // Groq bills reasoning tokens as completion tokens; they're
              // already inside completion_tokens, so this is reported for
              // visibility only and must not be added on top.
              reasoningTokens:
                u.completion_tokens_details?.reasoning_tokens ?? null,
            }
          : null,
      };
    } catch (err) {
      if (err instanceof LLMProviderError) throw err;
      if (err instanceof APIError) {
        if (err.status === 429) {
          throw new LLMProviderError("groq", "rate_limit", err.message);
        }
        if (err.status === 401 || err.status === 403) {
          throw new LLMProviderError("groq", "auth", err.message);
        }
      }
      throw new LLMProviderError(
        "groq",
        "unknown",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
