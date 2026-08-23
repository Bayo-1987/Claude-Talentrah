import "server-only";
import { GeminiProvider } from "./gemini-provider";
import { GroqProvider } from "./groq-provider";
import type { LLMProvider } from "./types";

export type { LLMProvider, LLMGenerateOptions, LLMChatTurn } from "./types";
export { LLMProviderError } from "./errors";

/**
 * Read once at module load, not per-request — switching providers is a
 * deploy-time decision (env var), not something that should vary within a
 * running process. Defaults to gemini so nothing changes for existing
 * deployments unless LLM_PROVIDER is explicitly set (infra task §2).
 */
const selectedProvider: LLMProvider =
  process.env.LLM_PROVIDER === "groq" ? new GroqProvider() : new GeminiProvider();

export function getLLMProvider(): LLMProvider {
  return selectedProvider;
}
