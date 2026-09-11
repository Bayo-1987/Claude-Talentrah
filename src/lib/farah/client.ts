import "server-only";
import { generateWithFailover, generateChatStreamWithFailover } from "@/lib/llm";
import { FARAH_SYSTEM_PROMPT } from "./system-prompt";
import { CHAT_MAX_OUTPUT_TOKENS } from "./token-budget";

/** One-shot text completion with Farah's voice as the system prompt. */
export async function askFarah(userMessage: string, maxTokens = 1536): Promise<string> {
  return generateWithFailover((provider) =>
    provider.generateText({
      systemPrompt: FARAH_SYSTEM_PROMPT,
      turns: [{ role: "user", content: userMessage }],
      maxOutputTokens: maxTokens,
    }),
  );
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
  // Chat-specific, and deliberately lower than askFarah's 1536: this is
  // reserved output, charged against Groq's TPM cap whether or not it is
  // used, and a conversational reply is not a document. askFarah's one-shot
  // callers (tailoring, gap analysis) keep the larger budget — confirmed by
  // repo-wide search that askFarahChat has exactly one caller.
  maxTokens = CHAT_MAX_OUTPUT_TOKENS,
): Promise<string> {
  const system = extraContext ? `${FARAH_SYSTEM_PROMPT}\n\n${extraContext}` : FARAH_SYSTEM_PROMPT;
  return generateWithFailover((provider) =>
    provider.generateText({
      systemPrompt: system,
      turns,
      maxOutputTokens: maxTokens,
    }),
  );
}

/**
 * Streaming counterpart to askFarahChat, for the docked panel's free-text
 * replies (chat/route.ts) — same system prompt/turns/token-budget
 * construction, yielding incremental text instead of waiting for the full
 * reply. See generateChatStreamWithFailover's own comment for the failover
 * boundary this inherits.
 */
export async function* askFarahChatStream(
  turns: FarahChatTurn[],
  extraContext?: string,
  maxTokens = CHAT_MAX_OUTPUT_TOKENS,
): AsyncGenerator<string> {
  const system = extraContext ? `${FARAH_SYSTEM_PROMPT}\n\n${extraContext}` : FARAH_SYSTEM_PROMPT;
  yield* generateChatStreamWithFailover((provider) =>
    provider.generateTextStream({
      systemPrompt: system,
      turns,
      maxOutputTokens: maxTokens,
    }),
  );
}
