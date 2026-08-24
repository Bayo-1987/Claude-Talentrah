import "server-only";
import { GoogleGenAI, ApiError, ThinkingLevel, type ThinkingConfig } from "@google/genai";
import { LLMProviderError } from "./errors";
import type { LLMProvider, LLMGenerateOptions, LLMResult } from "./types";

/**
 * Shared across every Gemini call Farah makes — chat, tailoring/gap
 * analysis, and the resume-parse LLM fallback. One model for consistency;
 * revisit only if a specific task's quality genuinely needs a different tier.
 */
export const GEMINI_MODEL = "gemini-3.6-flash";

/**
 * gemini-3.6-flash reasons by default, and that "thinking" draws from the
 * same maxOutputTokens budget as the visible answer — measured live at
 * ~950 of a 1024-token budget going to invisible thoughts, cutting a
 * 170-character reply off mid-sentence (finishReason: MAX_TOKENS) and
 * taking 24-45s. thinkingBudget: 0 (fully off) 400s on this model — MINIMAL
 * is the lowest level it accepts; verified live this drops replies to
 * ~10s with finishReason: STOP (not truncated). Revisit only if a specific
 * task's quality genuinely benefits from deeper reasoning. Gemini-specific —
 * Groq's llama-3.3-70b-versatile isn't a reasoning model, so there's no
 * equivalent knob on that adapter.
 */
export const THINKING_CONFIG: ThinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set — Farah's AI features need it configured in .env.local.",
    );
  }
  return new GoogleGenAI({ apiKey });
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini" as const;

  readonly model = GEMINI_MODEL;

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
    const client = getGeminiClient();

    try {
      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        // Gemini's role for the model's own turns is "model", not "assistant".
        contents: turns.map((t) => ({
          role: t.role === "assistant" ? "model" : "user",
          parts: [{ text: t.content }],
        })),
        config: {
          ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
          maxOutputTokens,
          thinkingConfig: THINKING_CONFIG,
          // Gemini's responseSchema accepts standard JSON Schema directly
          // (the SDK forwards it as responseJsonSchema internally) and
          // gives real constrained decoding — no prompt-side workaround
          // needed the way the Groq adapter needs one.
          ...(jsonSchema
            ? { responseMimeType: "application/json", responseSchema: jsonSchema }
            : {}),
        },
      });

      const text = response.text;
      if (!text) {
        throw new LLMProviderError("gemini", "unknown", "Gemini returned an empty response.");
      }
      const u = response.usageMetadata;
      return {
        text,
        usage: u
          ? {
              inputTokens: u.promptTokenCount ?? 0,
              outputTokens: u.candidatesTokenCount ?? 0,
              totalTokens: u.totalTokenCount ?? 0,
              // Billed as output even though it never appears in `text`.
              reasoningTokens: u.thoughtsTokenCount ?? null,
            }
          : null,
      };
    } catch (err) {
      if (err instanceof LLMProviderError) throw err;
      if (err instanceof ApiError) {
        if (err.status === 429) {
          throw new LLMProviderError("gemini", "rate_limit", err.message);
        }
        if (err.status === 401 || err.status === 403) {
          throw new LLMProviderError("gemini", "auth", err.message);
        }
      }
      throw new LLMProviderError(
        "gemini",
        "unknown",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
