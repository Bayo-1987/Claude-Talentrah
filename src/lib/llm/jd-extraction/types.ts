import type { LLMUsage } from "../types";

export interface JdExtractionResult {
  /** Lowercase, deduplicated-by-the-caller skill/requirement strings, in the
   * same shape SKILL_VOCABULARY entries already take (short noun phrases —
   * "stata", "survey design" — not full sentences). */
  skills: string[];
  usage: LLMUsage | null;
}

/**
 * Deliberately its OWN interface, not a reuse of `LLMProvider` from
 * `src/lib/llm/types.ts`. That interface is shaped around Farah's chat/
 * tailoring calls (multi-turn, streaming, a JSON schema spelled out per
 * call) — this one call site needs none of that, and forcing this into the
 * same shape would make it trivial to accidentally wire a JD-extraction
 * call through `getLLMProvider()`/`generateWithFailover` and onto Farah's
 * own shared Groq account, which is exactly the isolation failure this
 * whole feature exists to avoid. A separate interface makes that a type
 * error instead of a code-review catch.
 */
export interface JdExtractionProvider {
  readonly name: string;
  readonly model: string;
  extractSkills(jdText: string): Promise<JdExtractionResult>;
}
