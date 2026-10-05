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

/**
 * The primary provider was rate-limited and the caller's `allowFallback` said the fallback may not be used (or could not say). Not an LLMProviderError on purpose: nothing that treats provider errors
 * (rate-limit wording, auth alarms) should mistake it for one. `cause` is the primary's rate-limit error.
 */
export class FallbackDeclinedError extends Error {
  constructor(public cause: unknown) {
    super("The fallback provider was not used.");
    this.name = "FallbackDeclinedError";
  }
}
