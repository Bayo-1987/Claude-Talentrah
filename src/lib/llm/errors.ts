/**
 * Typed so a quota/rate-limit error says which provider and what kind of
 * limit, rather than a generic failure — this exact ambiguity (was it
 * Gemini? was it actually down, or just rate-limited?) is what caused real
 * confusion earlier in this project.
 */
export class LLMProviderError extends Error {
  constructor(
    public provider: "gemini" | "groq",
    public kind: "rate_limit" | "auth" | "unknown",
    message: string,
  ) {
    super(`[${provider}/${kind}] ${message}`);
    this.name = "LLMProviderError";
  }
}
