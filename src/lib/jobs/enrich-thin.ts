import "server-only";
import { isThinScreenableTagSet } from "@/lib/match-tier";
import { NON_SCREENABLE_SKILLS } from "./extract-jd";
import { getJdExtractionProvider } from "@/lib/llm/jd-extraction";
import { isFeatureEnabled } from "@/lib/flags/read";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { StructuredJD } from "./types";

/**
 * Stage 8 "Step 1b" — docs/stage8-match-accuracy.md's own proposal section,
 * and docs/ingest-llm-enrichment.md for the fuller picture (isolation
 * status, ESCO sequencing). Read both before changing this file.
 *
 * ── WHAT THIS DOES ─────────────────────────────────────────────────────────
 *
 * For a posting that is STILL thin (`isThinScreenableTagSet`) after the
 * heuristic extraction that already ran at ingest (`extractStructuredJd`),
 * make one LLM call to pull additional real requirements out of the free
 * text, and merge them into the SAME `structured_jd.skills` field
 * `computeMatchScore` already reads — richer input to an unchanged formula,
 * never a second scoring path. This runs ONLY at ingest time, from
 * `ingestAllSources` (ingest.ts) — never at scoring/render time, so
 * `computeMatchScore`'s own "no LLM call per job" guarantee is untouched.
 *
 * ── WHY THIS IS OFF ────────────────────────────────────────────────────────
 *
 * Gated on the `ingest_llm_enrichment` feature flag (0164, same primitive as
 * job_match_digest/proactive_match_alert — 0080/0131), checked FIRST and
 * before any query. `isFeatureEnabled` fails closed on any error, so a
 * flags-table read failure disables this rather than silently enabling it.
 * As of this PR the flag is false and MUST STAY false until both:
 *
 *   1. A genuinely isolated LLM account exists (see
 *      src/lib/llm/jd-extraction/groq-provider.ts's isolation guard and
 *      docs/ingest-llm-enrichment.md — not provisioned in this PR).
 *   2. The ESCO taxonomy decision (PR #415) has landed one way or the other
 *      — this feature's real target population is "thin after ESCO", which
 *      #415 measured as meaningfully smaller than "thin after today's
 *      heuristic alone". Enabling this before that decision spends real
 *      budget on postings a cheaper, non-LLM fix might already have solved.
 */
export const INGEST_LLM_ENRICHMENT_FLAG = "ingest_llm_enrichment";

/** Oldest-thin-first, capped — a burst ingest (docs/stage8-match-accuracy.md's
 * own example: 61 postings from one new employer in one run) degrades to
 * "most get enriched over the next few days", never a request storm and
 * never a blocked ingest job. Overridable for a deliberate one-off larger
 * catch-up run without a code change. */
export const DEFAULT_MAX_ENRICHMENTS_PER_RUN = 10;

/** How many never-attempted open postings to pull per run before filtering
 * to the thin subset. Generously above the cap so a run with plenty of thin
 * candidates doesn't run dry after paging through a long run of postings
 * that already have enough tags — bounded rather than unbounded so a board
 * with a huge non-thin backlog still costs one fixed-size query. */
const CANDIDATE_FETCH_LIMIT = 500;

export interface EnrichmentCandidateRow {
  id: string;
  description: string | null;
  structured_jd: unknown;
  posted_at: string | null;
}

/**
 * Mirrors `computeMatchScore`'s own denominator EXACTLY (src/lib/matching/
 * score.ts: `jobSkillSet` is a `Set` of lowercased, non-screenable-filtered
 * skills — matchedSkills.length + missingSkills.length, the same number
 * `MatchTierBadge` reads as `screenableTagTotal`), not just something close
 * to it. A plain `.filter().length` over the raw array would double-count a
 * job whose `structured_jd.skills` happens to carry a duplicate, and this is
 * exactly the number `isThinScreenableTagSet` is calibrated against.
 */
function screenableTagCount(structuredJd: unknown): number {
  const skills = (structuredJd as StructuredJD | null | undefined)?.skills ?? [];
  const screenable = new Set(
    skills.map((s) => s.toLowerCase()).filter((s) => !NON_SCREENABLE_SKILLS.has(s)),
  );
  return screenable.size;
}

/**
 * Pure selection, deliberately DB-free: given a batch of open,
 * never-attempted postings (any order, already fetched), returns the ones
 * that are STILL thin — re-checked live from `structured_jd.skills` here,
 * never trusted from a cached flag, because a heuristic-vocabulary change
 * (e.g. ESCO terms landing) can move a posting out of "thin" between two
 * ingest runs without this table knowing — ordered oldest-`posted_at`-first
 * and capped at `cap`.
 *
 * Separated from the orchestration below specifically so the selection RULE
 * (what counts as thin, what order, what cap) is exhaustively unit-testable
 * without a database, independent of how the candidate rows were fetched.
 */
export function selectEnrichmentCandidates(
  rows: EnrichmentCandidateRow[],
  cap: number,
): EnrichmentCandidateRow[] {
  const thin = rows.filter((r) => isThinScreenableTagSet(screenableTagCount(r.structured_jd)));
  const sorted = [...thin].sort((a, b) => {
    const at = a.posted_at ? new Date(a.posted_at).getTime() : 0;
    const bt = b.posted_at ? new Date(b.posted_at).getTime() : 0;
    return at - bt;
  });
  return sorted.slice(0, Math.max(0, cap));
}

/**
 * Merges newly extracted terms into a posting's existing skill list:
 * lowercased, trimmed, de-duplicated against what's already there (existing
 * order preserved, new terms appended), with a floor against the exact
 * failure mode both step 1a's own header comment and the ESCO false-positive
 * pass (docs/stage8-match-accuracy.md) already document at length — a bare,
 * short, generic token is cheap for a model to emit and raises the
 * denominator without ever being able to raise the numerator. Anything
 * under 3 characters is dropped outright; this is deliberately a much
 * lighter filter than SKILL_VOCABULARY's own hand-curation, because the
 * whole point of this feature is covering terms a hand-maintained list
 * structurally cannot reach — a perfect filter here would just be
 * SKILL_VOCABULARY again.
 */
export function mergeExtractedSkills(existing: string[], extracted: string[]): string[] {
  const seen = new Set(existing.map((s) => s.toLowerCase().trim()));
  const merged = [...existing];
  for (const raw of extracted) {
    const s = raw.toLowerCase().trim();
    if (s.length < 3 || seen.has(s)) continue;
    seen.add(s);
    merged.push(s);
  }
  return merged;
}

export interface EnrichmentRunSummary {
  /** Whether the feature flag was on for this run. When false, every other
   * field is zero/empty and NO query beyond the flag read itself ran. */
  enabled: boolean;
  attempted: number;
  enriched: number;
  errors: string[];
}

const DISABLED_SUMMARY: EnrichmentRunSummary = { enabled: false, attempted: 0, enriched: 0, errors: [] };

/**
 * The orchestration `ingestAllSources` calls once per ingest run, after
 * every configured source has been fetched and upserted. See this file's
 * own header for the two gates that keep it a no-op today.
 */
export async function enrichThinPostings(
  cap: number = Number(process.env.INGEST_LLM_ENRICHMENT_MAX_PER_RUN) || DEFAULT_MAX_ENRICHMENTS_PER_RUN,
): Promise<EnrichmentRunSummary> {
  if (!(await isFeatureEnabled(INGEST_LLM_ENRICHMENT_FLAG))) {
    return DISABLED_SUMMARY;
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("job_postings")
    .select("id, description, structured_jd, posted_at")
    .eq("status", "open")
    .is("llm_enrichment_attempted_at", null)
    .order("posted_at", { ascending: true })
    .limit(CANDIDATE_FETCH_LIMIT);
  if (error) throw error;

  const candidates = selectEnrichmentCandidates((data ?? []) as EnrichmentCandidateRow[], cap);
  const provider = getJdExtractionProvider();
  const errors: string[] = [];
  let enriched = 0;

  for (const row of candidates) {
    const attemptedAt = new Date().toISOString();
    try {
      const { skills } = await provider.extractSkills(row.description ?? "");
      const existingStructuredJd = (row.structured_jd as Record<string, unknown> | null) ?? {};
      const existingSkills = Array.isArray(existingStructuredJd.skills)
        ? (existingStructuredJd.skills as string[])
        : [];
      const merged = mergeExtractedSkills(existingSkills, skills);

      const { error: updateError } = await supabase
        .from("job_postings")
        .update({
          structured_jd: { ...existingStructuredJd, skills: merged, keywords: merged },
          llm_enrichment_attempted_at: attemptedAt,
        })
        .eq("id", row.id);
      if (updateError) throw updateError;
      enriched++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${row.id}: ${message}`);
      /*
       * Marked attempted EVEN ON FAILURE — a posting whose call fails once
       * (a malformed JD, a transient provider error) must not be retried
       * every single ingest run forever. That would turn one broken posting
       * into a standing, silent drain against the very cap this feature
       * exists to respect, at the expense of postings that could actually
       * be helped. Best-effort: if THIS update also fails, the posting is
       * retried next run, which just costs one more wasted call — no worse
       * than the failure this branch is already handling.
       */
      await supabase
        .from("job_postings")
        .update({ llm_enrichment_attempted_at: attemptedAt })
        .eq("id", row.id);
    }
  }

  return { enabled: true, attempted: candidates.length, enriched, errors };
}
