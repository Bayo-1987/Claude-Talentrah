import "server-only";
import { GoogleGenAI, ThinkingLevel, type ThinkingConfig } from "@google/genai";
import { FARAH_SYSTEM_PROMPT } from "./system-prompt";

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
 * task's quality genuinely benefits from deeper reasoning.
 */
export const THINKING_CONFIG: ThinkingConfig = { thinkingLevel: ThinkingLevel.MINIMAL };

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set — Farah's AI features need it configured in .env.local.",
    );
  }
  return new GoogleGenAI({ apiKey });
}

/** One-shot text completion with Farah's voice as the system prompt. */
export async function askFarah(userMessage: string, maxTokens = 1536): Promise<string> {
  const client = getGeminiClient();
  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: userMessage }] }],
    config: {
      systemInstruction: FARAH_SYSTEM_PROMPT,
      maxOutputTokens: maxTokens,
      thinkingConfig: THINKING_CONFIG,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Farah didn't return a text response.");
  }
  return text;
}

export interface FarahChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Multi-turn chat completion for the docked Farah panel (build-prompt
 * §6.5). `extraContext`, when given, is appended to the shared system
 * prompt as grounding (e.g. the user's resume summary) — never as a
 * separate "system" turn, so it stays subject to the same "never invent
 * facts" instruction as the rest of Farah's voice.
 */
export async function askFarahChat(
  turns: FarahChatTurn[],
  extraContext?: string,
  maxTokens = 1536,
): Promise<string> {
  const client = getGeminiClient();
  const system = extraContext ? `${FARAH_SYSTEM_PROMPT}\n\n${extraContext}` : FARAH_SYSTEM_PROMPT;
  const response = await client.models.generateContent({
    model: GEMINI_MODEL,
    // Gemini's role for the model's own turns is "model", not "assistant".
    contents: turns.map((t) => ({
      role: t.role === "assistant" ? "model" : "user",
      parts: [{ text: t.content }],
    })),
    config: {
      systemInstruction: system,
      maxOutputTokens: maxTokens,
      thinkingConfig: THINKING_CONFIG,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Farah didn't return a text response.");
  }
  return text;
}
