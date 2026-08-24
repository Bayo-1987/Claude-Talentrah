import "server-only";
import { GeminiProvider } from "./gemini-provider";
import { GroqProvider } from "./groq-provider";
import { StubProvider } from "./stub-provider";
import type { LLMProvider } from "./types";

export type { LLMProvider, LLMGenerateOptions, LLMChatTurn, LLMUsage, LLMResult } from "./types";
export { LLMProviderError } from "./errors";

/**
 * Read once at module load, not per-request — switching providers is a
 * deploy-time decision (env var), not something that should vary within a
 * running process. Defaults to gemini so nothing changes for existing
 * deployments unless LLM_PROVIDER is explicitly set (infra task §2).
 */
function pickProvider(): LLMProvider {
  // "stub" is test-only (see stub-provider.ts) and must be opted into
  // explicitly. Deliberately not part of any fallback: anything unset or
  // unrecognised still resolves to Gemini, so a typo can never put fake
  // model output in front of a real user.
  if (process.env.LLM_PROVIDER === "stub") {
    console.warn("[llm] StubProvider active — no real model calls. This must never be production.");
    return new StubProvider();
  }
  return process.env.LLM_PROVIDER === "groq" ? new GroqProvider() : new GeminiProvider();
}

const selectedProvider: LLMProvider = pickProvider();

export function getLLMProvider(): LLMProvider {
  return selectedProvider;
}
