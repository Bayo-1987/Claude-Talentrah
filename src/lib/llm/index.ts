import "server-only";
import { GeminiProvider } from "./gemini-provider";
import { GroqProvider } from "./groq-provider";
import { StubProvider } from "./stub-provider";
import { LLMProviderError } from "./errors";
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

/**
 * The provider to retry against when the primary is rate-limited (send-112 —
 * Groq's 200,000-token daily quota, send-109, exhausted mid-testing and
 * failed every Farah chat call for the rest of that window). Built from the
 * env var directly, not from `selectedProvider.name`: StubProvider spoofs
 * `name: "groq"` for schema-synthesis reasons unrelated to routing (see its
 * own header comment) — keying off `.name` would wire a real Gemini call
 * into e2e's deliberately offline provider path. Only Groq→Gemini exists
 * today; nothing runs Gemini as the primary in production, so the reverse
 * direction has no real incident to serve yet.
 */
function getFailoverProvider(): LLMProvider | null {
  return process.env.LLM_PROVIDER === "groq" ? new GeminiProvider() : null;
}

/**
 * Runs `call` against the primary provider; if it throws a `rate_limit`
 * LLMProviderError, retries the SAME call once against the failover
 * provider instead of surfacing the error. `auth` and `unknown` errors are
 * NOT retried here — those mean something is actually broken (a bad key, a
 * genuinely down provider), and silently routing around a broken primary
 * would hide that rather than fail loudly.
 *
 * Deliberately separate from `getLLMProvider()` rather than folded into it:
 * cost-probe.ts monkey-patches the singleton `getLLMProvider()` returns
 * (`provider.generateWithUsage = ...`) to capture real usage, which only
 * works because that object IS the real provider instance and its own
 * `generateText` calls `this.generateWithUsage`. Returning a synthetic
 * wrapper object from `getLLMProvider()` instead would silently break that
 * capture — the patched method would sit on an object nothing calls through.
 * Callers that want failover call this directly; `getLLMProvider()` and
 * everything built on its exact object identity is untouched.
 */
export async function generateWithFailover(
  call: (provider: LLMProvider) => Promise<string>,
): Promise<string> {
  const primary = getLLMProvider();
  try {
    return await call(primary);
  } catch (err) {
    if (!(err instanceof LLMProviderError) || err.kind !== "rate_limit") throw err;
    const fallback = getFailoverProvider();
    if (!fallback) throw err;
    console.warn(`[llm] ${primary.name} rate-limited — retrying via ${fallback.name}`);
    const result = await call(fallback);
    console.info(`[llm] request served by fallback provider ${fallback.name}`);
    return result;
  }
}
