import "server-only";
import { generateWithFailover, generateChatStreamWithFailover, type ServedBy } from "@/lib/llm";
import { logFarahCall } from "./call-log";
import { FARAH_SYSTEM_PROMPT } from "./system-prompt";
import { buildFarahChatSystemPrompt } from "./chat-prompt";
import type { LLMFinishReason, LLMUsage } from "@/lib/llm/types";
import { CHAT_MAX_OUTPUT_TOKENS } from "./token-budget";

/**
 * Writes the one success line (call-log.ts) for a Farah call, given when it started and who served it.
 * Takes no text of any kind, by design.
 */
function logSuccess(startedAt: number, served: ServedBy | undefined, usage?: LLMUsage | null): void {
  if (!served) return;
  logFarahCall({
    provider: served.provider.name,
    model: served.provider.model,
    latencyMs: performance.now() - startedAt,
    failover: served.failover,
    promptTokens: usage?.inputTokens ?? null,
    completionTokens: usage?.outputTokens ?? null,
  });
}

/** One-shot text completion with Farah's voice as the system prompt. */
export async function askFarah(userMessage: string, maxTokens = 1536): Promise<string> {
  const startedAt = performance.now();
  let served: ServedBy | undefined;
  let usage: LLMUsage | null = null;
  const text = await generateWithFailover(
    async (provider) => {
      const result = await provider.generateWithUsage({
        systemPrompt: FARAH_SYSTEM_PROMPT,
        turns: [{ role: "user", content: userMessage }],
        maxOutputTokens: maxTokens,
      });
      usage = result.usage;
      return result.text;
    },
    (s) => (served = s),
  );
  logSuccess(startedAt, served, usage);
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
  // Chat-specific, and deliberately lower than askFarah's 1536: this is
  // reserved output, charged against Groq's TPM cap whether or not it is
  // used, and a conversational reply is not a document. askFarah's one-shot
  // callers (tailoring, gap analysis) keep the larger budget — confirmed by
  // repo-wide search that askFarahChat has exactly one caller.
  maxTokens = CHAT_MAX_OUTPUT_TOKENS,
): Promise<string> {
  const system = buildFarahChatSystemPrompt({ extraContext });
  const startedAt = performance.now();
  let served: ServedBy | undefined;
  let usage: LLMUsage | null = null;
  const text = await generateWithFailover(
    async (provider) => {
      const result = await provider.generateWithUsage({
        systemPrompt: system,
        turns,
        maxOutputTokens: maxTokens,
      });
      usage = result.usage;
      return result.text;
    },
    (s) => (served = s),
  );
  logSuccess(startedAt, served, usage);
  return text;
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
  opts: {
    /** The quick action this message came from; selects that action's own instructions (chat-prompt.ts). */
    quickAction?: string;
    /** Called once when the reply ends, with why it stopped. A `length` stop means the reply is cut off. */
    onFinish?: (reason: LLMFinishReason) => void;
    /** Called once when the reply ends, with the token counts the serving provider reported (not called when it reported none). */
    onUsage?: (usage: LLMUsage, served?: { provider: string; model: string }) => void;
    /** Aborting it ends the provider call (and the HTTP request under it). An aborted call throws; it is never a rate limit, so it never fails over. */
    signal?: AbortSignal;
    /** Asked just before the fallback provider would be used (see generateChatStreamWithFailover). Absent: the fallback is used as before. */
    allowFallback?: () => Promise<boolean> | boolean;
    /** Server-built facts for the model (billing-facts.ts, page-facts.ts), already assembled by the route from its own catalog and this user's own account. */
    facts?: string;
  } = {},
): AsyncGenerator<string> {
  const system = buildFarahChatSystemPrompt({ quickAction: opts.quickAction, extraContext, facts: opts.facts });
  const startedAt = performance.now();
  let served: ServedBy | undefined;
  let chunks = 0;
  let usage: LLMUsage | null = null;
  for await (const chunk of generateChatStreamWithFailover(
    (provider) =>
      provider.generateTextStream({
        systemPrompt: system,
        turns,
        maxOutputTokens: maxTokens,
        signal: opts.signal,
        // Set per provider attempt: after a failover the fallback's own report is the one that stands.
        onFinish: opts.onFinish,
        // Likewise per attempt: the provider that served the reply is the one whose counts are logged.
        onUsage: (u) => {
          usage = u;
          opts.onUsage?.(u, { provider: provider.name, model: provider.model });
        },
      }),
    (s) => (served = s),
    { allowFallback: opts.allowFallback },
  )) {
    chunks++;
    yield chunk;
  }
  // Reached only when the stream completed without throwing, and only if it said anything: the chat route
  // treats a zero-chunk reply as a failure, so it is not logged as a success here either. For a stream the
  // latency is the whole reply, start to finish — not time to first token.
  if (chunks > 0) logSuccess(startedAt, served, usage);
}
