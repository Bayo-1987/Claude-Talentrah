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

export interface LLMProvider {
  readonly name: "gemini" | "groq";
  generateText(options: LLMGenerateOptions): Promise<string>;
}
