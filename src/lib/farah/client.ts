import "server-only";
import { getLLMProvider } from "@/lib/llm";
import { FARAH_SYSTEM_PROMPT } from "./system-prompt";

/** One-shot text completion with Farah's voice as the system prompt. */
export async function askFarah(userMessage: string, maxTokens = 1536): Promise<string> {
  return getLLMProvider().generateText({
    systemPrompt: FARAH_SYSTEM_PROMPT,
    turns: [{ role: "user", content: userMessage }],
    maxOutputTokens: maxTokens,
  });
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
  const system = extraContext ? `${FARAH_SYSTEM_PROMPT}\n\n${extraContext}` : FARAH_SYSTEM_PROMPT;
  return getLLMProvider().generateText({
    systemPrompt: system,
    turns,
    maxOutputTokens: maxTokens,
  });
}
