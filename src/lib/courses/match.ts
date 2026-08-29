import type { GapAnalysisItem } from "@/lib/tailoring/types";
import { normalizeSkillKeyword } from "./normalize";

/**
 * Gap analysis in, ranked course recommendations out. Pure — no database, no
 * network, no clock.
 *
 * The catalog rows are passed in rather than fetched here so this can be
 * tested against fixtures, and so the caller decides freshness. M2 and M3 will
 * each query `course_recommendations` their own way; the ranking must not care.
 */

/** The columns ranking needs. A superset row from the table satisfies it. */
export interface CourseRow {
  id: string;
  skill_tag: string;
  provider: string;
  title: string;
  affiliate_url: string;
  price_tier: "free" | "low" | "mid" | "high";
  active?: boolean;
}

export interface RankedRecommendation {
  course: CourseRow;
  /** The gap-analysis keyword that produced it, verbatim, for the UI to echo. */
  matchedKeyword: string;
  /** Canonical tag the keyword normalised to. */
  skillTag: string;
  /** JD mentions parsed from `note`, or null when the note did not say. */
  jdMentions: number | null;
}

/** §6.9's affordability tiering, as an order rather than a label. */
const TIER_RANK: Record<CourseRow["price_tier"], number> = {
  free: 0,
  low: 1,
  mid: 2,
  high: 3,
};

/**
 * Pull a JD mention count out of the gap-analysis note.
 *
 * WHAT THIS FIELD ACTUALLY IS, because the plan is slightly optimistic about
 * it: `note` is OPTIONAL and freeform. Its schema in tailor.ts is
 * `{ type: "string", description: "Short, specific note — e.g. how many times
 * it appears in the JD vs. resume" }` and it is absent from that object's
 * `required` list. So "the note already carries frequency info" holds when the
 * model follows the example and not otherwise, and nothing enforces the
 * wording.
 *
 * Hence: several shapes accepted, and a null return that the caller must
 * handle rather than a 0 that would quietly sort like a real measurement.
 */
export function parseJdMentions(note: string | undefined | null): number | null {
  if (!note) return null;
  const patterns = [
    /(\d+)\s*x\s+in\s+(?:this\s+)?(?:the\s+)?jd/i, // "3x in this JD"
    /appears?\s+(\d+)\s*x/i, //                        "appears 3x"
    /appears?\s+(\d+)\s+times?/i, //                   "appears 3 times"
    /mentioned\s+(\d+)\s+times?/i, //                  "mentioned 3 times"
    /(\d+)\s+times?\s+in\s+(?:this\s+)?(?:the\s+)?jd/i, // "3 times in the JD"
  ];
  for (const pattern of patterns) {
    const hit = note.match(pattern);
    if (hit) {
      const n = Number.parseInt(hit[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export interface RankOptions {
  /**
   * Default 2. The plan's "one, maybe two" — a wall of affiliate links under
   * every result reads as an ad unit, and the design system's restrained
   * badge density is the same instinct applied to a different surface.
   */
  limit?: number;
}

/**
 * Ranks recommendations for the MISSING keywords in a gap analysis.
 *
 * ── The ordering, and why every step of it is defined ─────────────────────
 *
 * 1. Missing keywords only. A skill the resume already covers does not need a
 *    course, and recommending one would read as not having looked.
 * 2. Keywords that normalise to a curated tag. The rest produce nothing.
 * 3. Sort by JD mentions, descending — the JD's own emphasis is the best
 *    available signal for which gap matters most.
 * 4. Ties broken by the keyword's ORIGINAL POSITION in the array, so the JD's
 *    own sequence decides rather than the catalog's insertion order. Ties are
 *    the common case, not the rare one, because `note` is so often absent.
 *
 *    Stated accurately: this line is explicit rather than load-bearing.
 *    Array.prototype.sort has been stable since ES2019, so equal elements
 *    would keep their input order anyway — removing it changes no test, which
 *    was checked rather than assumed. It stays because it says what the
 *    ordering is instead of leaving it resting on a property of sort that a
 *    future refactor to a different ordering strategy would silently drop.
 * 5. One recommendation per skill tag. Two courses in the same skill is a
 *    catalog decision, not a result the reader needs both halves of.
 * 6. Within a tag, the cheapest tier wins, then title alphabetically. Also
 *    deliberate: §6.9 tiers by affordability, so when two courses teach the
 *    same thing the affordable one is the one to offer.
 */
export function rankCourseRecommendations(
  gapAnalysis: GapAnalysisItem[],
  catalog: CourseRow[],
  { limit = 2 }: RankOptions = {},
): RankedRecommendation[] {
  if (limit <= 0) return [];

  const available = catalog.filter((c) => c.active !== false);
  if (available.length === 0) return [];

  /** Best row per tag: cheapest tier, then title. Deterministic either way. */
  const bestByTag = new Map<string, CourseRow>();
  for (const course of available) {
    const held = bestByTag.get(course.skill_tag);
    if (!held) {
      bestByTag.set(course.skill_tag, course);
      continue;
    }
    const cheaper = TIER_RANK[course.price_tier] - TIER_RANK[held.price_tier];
    if (cheaper < 0 || (cheaper === 0 && course.title.localeCompare(held.title) < 0)) {
      bestByTag.set(course.skill_tag, course);
    }
  }

  const candidates = gapAnalysis
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === "missing")
    .map(({ item, index }) => {
      const skillTag = normalizeSkillKeyword(item.keyword);
      return skillTag
        ? {
            index,
            skillTag,
            matchedKeyword: item.keyword,
            jdMentions: parseJdMentions(item.note),
          }
        : null;
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    .filter((c) => bestByTag.has(c.skillTag));

  candidates.sort((a, b) => {
    // A note that did not state a count must not outrank one that stated a
    // low count — unknown sorts below known, rather than as zero.
    const am = a.jdMentions ?? -1;
    const bm = b.jdMentions ?? -1;
    if (am !== bm) return bm - am;
    return a.index - b.index;
  });

  const out: RankedRecommendation[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.skillTag)) continue;
    seen.add(candidate.skillTag);
    out.push({
      course: bestByTag.get(candidate.skillTag)!,
      matchedKeyword: candidate.matchedKeyword,
      skillTag: candidate.skillTag,
      jdMentions: candidate.jdMentions,
    });
    if (out.length >= limit) break;
  }
  return out;
}
