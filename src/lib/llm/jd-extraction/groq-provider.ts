import "server-only";
import OpenAI, { APIError } from "openai";
import { LLMProviderError } from "../errors";
import type { JdExtractionProvider, JdExtractionResult } from "./types";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * Smaller/cheaper than `GROQ_MODEL` (src/lib/llm/groq-provider.ts, the
 * 120B model Farah's tailoring/chat calls use) — this call's own job is a
 * short list of skill strings from one JD, not a reasoning-heavy generation,
 * so there is no reason to pay for the larger model. Override via
 * JD_EXTRACTION_GROQ_MODEL if Groq's catalog shifts (the primary provider's
 * own header comment notes this catalog is not stable) or if a real cost
 * probe (runCostProbe, "jd_extraction" group) finds this one underperforms.
 */
const DEFAULT_MODEL = "openai/gpt-oss-20b";

/** Same reasoning-eats-the-budget issue GROQ_MODEL's own REASONING_EFFORT
 * documents for gpt-oss-120b — gpt-oss-20b is the same model family. */
const REASONING_EFFORT = "low" as const;

/** Comfortably above the ~300-700 input / <100 output tokens
 * docs/stage8-match-accuracy.md's own Step 1b estimate expects; generous
 * headroom costs nothing against a call this cheap and avoids a truncated-
 * JSON retry on the rare long JD. */
const MAX_OUTPUT_TOKENS = 300;

const JD_EXTRACTION_SYSTEM_PROMPT = `You extract real, screenable skill and requirement terms from a job description.

Rules:
- Return ONLY short noun phrases a candidate's own resume "skills" field could plausibly echo verbatim (e.g. "stata", "survey design", "haccp") — never a full sentence, a soft trait, or a duty description.
- Do NOT return generic soft skills or traits: never "communication", "leadership", "operations", "teamwork", "problem solving", or anything of that shape.
- Do NOT invent a term that is not actually present (verbatim or as a very close paraphrase) in the job description text.
- Prefer specific, differentiating requirements over generic ones already implied by the job title.
- Return at most 8 terms. Return fewer if the description does not support more.
- Every term must be lowercase.

Respond with ONLY a JSON object: { "skills": string[] }. No markdown fences, no commentary.`;

function getIsolatedGroqClient(): OpenAI {
  const apiKey = process.env.JD_EXTRACTION_GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "JD_EXTRACTION_GROQ_API_KEY is not set. This must be a key on a GENUINELY SEPARATE Groq " +
        "account from the one GROQ_API_KEY belongs to — see docs/ingest-llm-enrichment.md. Set " +
        "JD_EXTRACTION_LLM_PROVIDER=stub (or leave it unset) to use the offline stub instead.",
    );
  }

  /*
   * The isolation guard this whole feature exists to enforce, made
   * mechanical rather than left to a comment someone has to remember to
   * re-read. CLAUDE.md's own incident history: Groq's 200,000 TPD ceiling is
   * shared ACCOUNT-WIDE, not per key — a second key on the SAME account as
   * production's GROQ_API_KEY is not isolation, it is a second consumer of
   * the same budget, and would risk a third Farah outage of exactly the
   * kind already logged twice (send-109, send-112). Comparing the two env
   * vars cannot detect "same account, different key" (Groq does not expose
   * an account id in the key string), but it DOES catch the single most
   * likely real mistake — pasting the existing key into the new variable
   * because it "already works" — and fails loudly instead of silently
   * sharing the budget.
   */
  if (apiKey === process.env.GROQ_API_KEY) {
    throw new Error(
      "JD_EXTRACTION_GROQ_API_KEY is set to the SAME value as GROQ_API_KEY. That is not isolation " +
        "— Groq's daily token budget (TPD) is shared per ACCOUNT, not per key (CLAUDE.md's own " +
        "incident history: this exact cap took Farah chat down twice). Provision a key on a " +
        "genuinely separate Groq account before enabling this provider.",
    );
  }

  return new OpenAI({ apiKey, baseURL: GROQ_BASE_URL, timeout: 20_000 });
}

/**
 * Real LLM-backed JD-extraction provider. Only ever instantiated when
 * `JD_EXTRACTION_LLM_PROVIDER=groq` is set (see ./index.ts) — NOT enabled by
 * default, and the `ingest_llm_enrichment` feature flag (checked separately,
 * in src/lib/jobs/enrich-thin.ts) is a second, independent gate on top of
 * that. As of this PR neither gate is on: no genuinely isolated Groq account
 * was provisioned (see docs/ingest-llm-enrichment.md for the full status),
 * so this class exists, is tested against a mocked HTTP layer, and has never
 * made a real call in this codebase's history.
 */
export class GroqJdExtractionProvider implements JdExtractionProvider {
  readonly name = "groq-jd-extraction";
  readonly model = process.env.JD_EXTRACTION_GROQ_MODEL || DEFAULT_MODEL;

  async extractSkills(jdText: string): Promise<JdExtractionResult> {
    const client = getIsolatedGroqClient();

    try {
      const response = await client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: JD_EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: jdText },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        reasoning_effort: REASONING_EFFORT,
        response_format: { type: "json_object" },
      });

      const text = response.choices[0]?.message?.content;
      if (!text) {
        throw new LLMProviderError("groq", "unknown", "Groq JD-extraction call returned an empty response.");
      }

      const skills = parseSkillsResponse(text);
      const u = response.usage;
      return {
        skills,
        usage: u
          ? {
              inputTokens: u.prompt_tokens ?? 0,
              outputTokens: u.completion_tokens ?? 0,
              totalTokens: u.total_tokens ?? 0,
              reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? null,
            }
          : null,
      };
    } catch (err) {
      if (err instanceof LLMProviderError) throw err;
      if (err instanceof APIError) {
        if (err.status === 429) throw new LLMProviderError("groq", "rate_limit", err.message);
        if (err.status === 401 || err.status === 403) throw new LLMProviderError("groq", "auth", err.message);
      }
      throw new LLMProviderError("groq", "unknown", err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Tolerant of the two real shapes a JSON-mode model can hand back: the
 * spec'd `{ "skills": [...] }`, or (seen from smaller/quantized models under
 * json_object mode elsewhere in this codebase — see GroqProvider's own
 * comment on best-effort JSON mode) a bare array. Anything else — a parse
 * failure, a missing/malformed field — degrades to an empty list rather than
 * throwing: a posting this call could not enrich just stays exactly as thin
 * as the heuristic left it, which is the safe failure mode for an
 * additive-only feature.
 */
function parseSkillsResponse(text: string): string[] {
  try {
    const parsed = JSON.parse(text);
    const raw = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.skills) ? parsed.skills : [];
    return raw.filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0);
  } catch {
    return [];
  }
}
