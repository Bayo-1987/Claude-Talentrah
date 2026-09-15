import "server-only";
import { StubJdExtractionProvider } from "./stub-provider";
import { GroqJdExtractionProvider } from "./groq-provider";
import type { JdExtractionProvider } from "./types";

export type { JdExtractionProvider, JdExtractionResult } from "./types";

/**
 * Read once at module load, mirroring `src/lib/llm/index.ts`'s own
 * `pickProvider` — but with the OPPOSITE default. That module defaults an
 * unset/unrecognised `LLM_PROVIDER` to a REAL provider (Gemini), because
 * Farah must always be able to answer something. This one must not: an
 * unset or unrecognised `JD_EXTRACTION_LLM_PROVIDER` resolves to the stub
 * (zero real calls, ever), so a missing env var or a typo can never spend a
 * real provider's quota. Real extraction needs an explicit
 * `JD_EXTRACTION_LLM_PROVIDER=groq` AND the `ingest_llm_enrichment` feature
 * flag (checked separately, in src/lib/jobs/enrich-thin.ts) — two
 * independent, deliberate opt-ins.
 */
function pickJdExtractionProvider(): JdExtractionProvider {
  if (process.env.JD_EXTRACTION_LLM_PROVIDER === "groq") {
    return new GroqJdExtractionProvider();
  }
  return new StubJdExtractionProvider();
}

const selectedProvider: JdExtractionProvider = pickJdExtractionProvider();

export function getJdExtractionProvider(): JdExtractionProvider {
  return selectedProvider;
}
