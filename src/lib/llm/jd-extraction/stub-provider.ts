import "server-only";
import type { JdExtractionProvider, JdExtractionResult } from "./types";

/**
 * Deterministic, offline JD-extraction provider — the default whenever
 * `JD_EXTRACTION_LLM_PROVIDER` is unset or anything other than "groq" (see
 * ./index.ts). Same spirit as `src/lib/llm/stub-provider.ts` (deterministic
 * output, zero real usage, never a silent fallback in front of a real
 * incident) but its own class: that stub implements `LLMProvider` and
 * synthesizes from an arbitrary caller-supplied JSON schema, which is the
 * wrong shape for the fixed `{ skills: string[] }` contract this feature
 * needs, and importing it here would blur the "these are two structurally
 * separate call paths" boundary `types.ts`'s own header comment argues for.
 *
 * Deliberately not gated on a test/CI-only env var the way the real
 * StubProvider is: THIS one is the safe default everywhere. Real extraction
 * requires both `JD_EXTRACTION_LLM_PROVIDER=groq` (a real provider) AND
 * `ingest_llm_enrichment` (the feature flag, checked in enrich-thin.ts) —
 * two independent, deliberate opt-ins, not an env var typo away from either.
 */
export class StubJdExtractionProvider implements JdExtractionProvider {
  readonly name = "stub";
  readonly model = "stub-jd-extraction";

  async extractSkills(): Promise<JdExtractionResult> {
    return {
      // A fixed, obviously-synthetic value — never mistakeable for a real
      // model's output if it ever leaked into a real posting's
      // structured_jd.skills (it can't: this provider only runs when the
      // real one wasn't selected, which is also when the flag gating the
      // whole feature is expected to be off).
      skills: ["stub-jd-extraction-skill"],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: null },
    };
  }
}
