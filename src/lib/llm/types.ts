export interface LLMChatTurn {
  role: "user" | "assistant";
  content: string;
}

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
}
