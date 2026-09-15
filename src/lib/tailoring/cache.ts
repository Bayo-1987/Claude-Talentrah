import "server-only";
import crypto from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { StructuredResume } from "@/lib/resume/types";
import type { TailoringResult } from "./types";

/**
 * Bump this whenever tailorResumeToJob's prompt, response schema, or
 * post-processing (the grounding backstop, preserveNewFields, sanitization)
 * changes in a way that could make an old cached result look wrong under
 * today's code. It's folded directly into the cache key, so a version bump
 * orphans every existing row immediately — no migration, no manual purge,
 * no reliance on the TTL alone to age old rows out.
 *
 * See supabase/migrations/0162_tailoring_result_cache.sql's header for the
 * full reasoning on why this exists alongside (not instead of) the TTL.
 */
const TAILORING_CACHE_VERSION = 1;

/**
 * Storage hygiene only, NOT the mechanism that protects correctness against
 * a changed JD or resume — the content hash already does that (a change
 * produces a different key, full stop). See the migration header for why
 * this number is 30 days.
 */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Collapse cosmetic whitespace differences (line-ending style, repeated
 * blank lines, trailing spaces) so two pastes of the same JD text hash the
 * same. Deliberately NOT lowercased or otherwise semantically normalized —
 * this cache trades a few avoidable misses (whitespace-only differences)
 * for zero risk of two meaningfully different JDs colliding on the same key.
 */
function normalizeJdText(jdText: string): string {
  return jdText.trim().replace(/\s+/g, " ");
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export interface TailoringCacheKeys {
  cacheKey: string;
  jdTextHash: string;
  resumeContentHash: string;
}

/**
 * The cache key is a function of everything that legitimately changes
 * tailorResumeToJob's output:
 *   - the normalized JD text (different requirements -> different result)
 *   - the base resume's full structured content (the same JD tailored
 *     against two different resumes must never share a cache entry)
 *   - includeCoverLetter (the prompt itself differs, and the result carries
 *     a cover letter or doesn't)
 *   - TAILORING_CACHE_VERSION (so a pipeline change invalidates old rows)
 *
 * Two different users with byte-identical resume content and JD text WILL
 * share a cache entry. That's safe, not a leak: the cached output is a
 * deterministic function of exactly the input the second user already
 * supplied themselves — nothing about a third party is exposed.
 */
export function computeTailoringCacheKey(
  baseResume: StructuredResume,
  jdText: string,
  includeCoverLetter: boolean,
): TailoringCacheKeys {
  const jdTextHash = sha256Hex(normalizeJdText(jdText));
  const resumeContentHash = sha256Hex(JSON.stringify(baseResume));
  const cacheKey = sha256Hex(
    `v${TAILORING_CACHE_VERSION}:${jdTextHash}:${resumeContentHash}:${includeCoverLetter ? "cl1" : "cl0"}`,
  );
  return { cacheKey, jdTextHash, resumeContentHash };
}

/**
 * Fails open: any error reading the cache (including a Supabase client that
 * can't be constructed at all) is treated as a cache miss, never as a
 * reason to break tailoring. Caching is a cost optimization, not a
 * correctness dependency.
 */
export async function getCachedTailoringResult(cacheKey: string): Promise<TailoringResult | null> {
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("tailoring_result_cache")
      .select("result")
      .eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error || !data) return null;

    // Best-effort observability bump — never let this delay or fail the hit
    // it's recording.
    supabase
      .rpc("record_tailoring_cache_hit", { p_cache_key: cacheKey })
      .then(({ error: hitError }) => {
        if (hitError) console.error("Tailoring cache: failed to record hit", hitError);
      });

    return data.result as unknown as TailoringResult;
  } catch (err) {
    console.error("Tailoring cache: read failed, treating as a miss", err);
    return null;
  }
}

/**
 * Also fails open — a failure to WRITE the cache must never surface as a
 * failure of the tailoring run that already succeeded and is about to be
 * returned to the user.
 */
export async function saveTailoringResult(
  keys: TailoringCacheKeys,
  includeCoverLetter: boolean,
  result: TailoringResult,
): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();

    const { error } = await supabase.from("tailoring_result_cache").upsert(
      {
        cache_key: keys.cacheKey,
        jd_text_hash: keys.jdTextHash,
        resume_content_hash: keys.resumeContentHash,
        include_cover_letter: includeCoverLetter,
        result: JSON.parse(JSON.stringify(result)),
        expires_at: expiresAt,
      },
      { onConflict: "cache_key" },
    );

    if (error) console.error("Tailoring cache: failed to store result", error);
  } catch (err) {
    console.error("Tailoring cache: write failed", err);
  }
}
