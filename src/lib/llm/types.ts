export interface LLMChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Why a streamed reply stopped, provider-neutral. `length` means the model hit `maxOutputTokens`, i.e. the text
 * is cut off mid-thought. Anything else a provider reports that is not a clean stop is `other`, never `length`:
 * only a real length stop may be treated as "incomplete".
 */
export type LLMFinishReason = "stop" | "length" | "other";

export interface LLMGenerateOptions {
  /** Omitted entirely by the resume-parse fallback — not every call site uses one. */
  systemPrompt?: string;
  turns: LLMChatTurn[];
  maxOutputTokens: number;
  /**
   * JSON Schema the response should match. Providers differ in how much
   * they can actually enforce this — Gemini gets real constrained decoding,
   * Groq gets best-effort JSON mode plus the schema spelled out in the
   * prompt. Callers already parse+sanitize the result either way
   * (src/lib/resume/sanitize.ts), so "best-effort" is an acceptable
   * contract here, not a regression.
   */
  jsonSchema?: Record<string, unknown>;
  /**
   * Streaming only. Called once, when the stream ends, with why it stopped. Not called if the provider's stream
   * carried no reason (callers treat "never told" as finished), and not called if the stream threw. A callback
   * rather than a return value because `generateTextStream` is an async generator of text and every existing
   * caller consumes it as one.
   */
  onFinish?: (reason: LLMFinishReason) => void;
}

/**
 * Real token counts as the provider reported them, not an estimate derived
 * from prompt length. Used by scripts/estimate-llm-costs.ts to price actual
 * calls; null when a provider response omits the metadata.
 */
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /**
   * Reasoning/"thinking" tokens where the provider reports them separately.
   * These are billed as output on both providers but are invisible in the
   * returned text, so a cost estimate that ignores them understates spend.
   */
  reasoningTokens: number | null;
}

export interface LLMResult {
  text: string;
  usage: LLMUsage | null;
}

export interface LLMProvider {
  readonly name: "gemini" | "groq";
  /** The concrete model id, so cost tooling prices what actually ran. */
  readonly model: string;
  generateText(options: LLMGenerateOptions): Promise<string>;
  /**
   * Same call as generateText, additionally returning the provider's usage
   * metadata. generateText delegates here, so there is exactly one request
   * path per provider — this is not a second client.
   */
  generateWithUsage(options: LLMGenerateOptions): Promise<LLMResult>;
  /**
   * Same request as generateText, yielding incremental text chunks as the
   * provider produces them instead of waiting for the full reply. Only
   * meaningful for free-text calls (Farah chat) — a `jsonSchema` response
   * can't be safely parsed or displayed a chunk at a time, so no caller
   * streams one today. Usage metadata isn't collected here: the providers'
   * streaming APIs report it on the final chunk, not incrementally, and no
   * caller has needed it yet — add it if one does.
   */
  generateTextStream(options: LLMGenerateOptions): AsyncGenerator<string>;
}
