import "server-only";
import type { LLMGenerateOptions, LLMProvider, LLMResult } from "./types";

/**
 * Deterministic, offline LLM provider for end-to-end runs.
 *
 * Why this exists at the provider boundary rather than as a mocked route:
 * the golden-path e2e test needs to exercise the REAL routes, Server
 * Actions, gating, credit ledger and UI. The only thing it must not do is
 * make a real model call — that would make the most important test in the
 * suite slow, costly, and flaky on someone else's rate limit. Swapping the
 * provider is the narrowest possible seam: everything above it is the
 * genuine code path, and nothing at any call site knows the difference.
 *
 * Only ever selected by an explicit `LLM_PROVIDER=stub`, which is set in
 * CI's e2e job and nowhere else. It is never a fallback: an unset or
 * unrecognised LLM_PROVIDER still resolves to Gemini, so this cannot
 * silently activate in production and serve fake resumes to real users.
 *
 * Responses are synthesised from the caller's own `jsonSchema` rather than
 * hardcoded per feature, so a new schema-driven action works here with no
 * change — and a call site that changes its schema can't quietly drift away
 * from what the stub returns.
 */
export class StubProvider implements LLMProvider {
  readonly name = "groq" as const; // Structural: LLMProvider's name union is the real providers.
  readonly model = "stub-e2e";

  async generateText(options: LLMGenerateOptions): Promise<string> {
    return (await this.generateWithUsage(options)).text;
  }

  async generateWithUsage({ jsonSchema }: LLMGenerateOptions): Promise<LLMResult> {
    const text = jsonSchema
      ? JSON.stringify(synthesize(jsonSchema as JsonSchema))
      : "This is stubbed Farah output for an end-to-end test run.";

    return {
      text,
      // Reported as zero rather than invented: a fabricated token count
      // would silently corrupt the cost tooling if it ever ran against this.
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: null },
    };
  }
}

interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: unknown[];
  description?: string;
}

/**
 * Builds the smallest value satisfying a schema. Every declared property is
 * filled, not just the required ones, so optional fields the UI renders
 * (cover letter, ATS fixes) are present and visible in an e2e run.
 */
function synthesize(schema: JsonSchema): unknown {
  if (schema.enum?.length) return schema.enum[0];

  switch (schema.type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        out[key] = synthesize(child);
      }
      return out;
    }
    case "array":
      // One element, so list rendering is exercised rather than skipped by
      // an empty-state branch.
      return schema.items ? [synthesize(schema.items)] : [];
    case "integer":
    case "number":
      return 72;
    case "boolean":
      return true;
    default:
      return "stubbed";
  }
}
