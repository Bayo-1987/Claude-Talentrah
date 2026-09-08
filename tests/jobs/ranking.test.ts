/**
 * recommendedRankingKey (src/lib/jobs/ranking.ts) — Stage 12's Recommended
 * time-decay fix. The concrete scenario reported live: a Moniepoint role
 * posted 4 weeks ago at 100% always outranked a role posted today at 75%.
 */
import { describe, expect, it } from "vitest";
import { recommendedRankingKey, sortFeedResults } from "@/lib/jobs/ranking";
import type { ScoredJob } from "@/lib/matching/compute-and-store";

const NOW = new Date("2026-09-04T12:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();
const FLOOR_DAYS = 30;

describe("recommendedRankingKey", () => {
  it(
    "SABOTAGE-PROOF TARGET: a recent good-enough match outranks a stale perfect one " +
      "(the exact live scenario — Moniepoint 100% posted 4 weeks ago vs. a fresh 75%)",
    () => {
      const staleKey = recommendedRankingKey(100, daysAgo(28), FLOOR_DAYS, NOW);
      const freshKey = recommendedRankingKey(75, daysAgo(0), FLOOR_DAYS, NOW);
      expect(freshKey).toBeGreaterThan(staleKey);
    },
  );

  it("a brand-new posting takes no penalty at all", () => {
    expect(recommendedRankingKey(80, daysAgo(0), FLOOR_DAYS, NOW)).toBe(80);
  });

  it("a fully-aged (floor-boundary) posting takes the full, bounded penalty — never more", () => {
    const key = recommendedRankingKey(100, daysAgo(FLOOR_DAYS), FLOOR_DAYS, NOW);
    expect(key).toBe(70); // 100 - 30 (RECOMMENDED_DECAY_MAX_POINTS)
  });

  it("clamps rather than over-penalising something already past the floor", () => {
    // Structurally this should never happen — the floor already excludes it
    // upstream — but the function itself must not compound a bug by
    // subtracting more than the max even if it somehow received one.
    const atFloor = recommendedRankingKey(100, daysAgo(FLOOR_DAYS), FLOOR_DAYS, NOW);
    const wayPastFloor = recommendedRankingKey(100, daysAgo(FLOOR_DAYS + 100), FLOOR_DAYS, NOW);
    expect(wayPastFloor).toBe(atFloor);
  });

  it("does not grant a bonus for a future posted_at (clock skew)", () => {
    const future = new Date(NOW + DAY).toISOString();
    expect(recommendedRankingKey(80, future, FLOOR_DAYS, NOW)).toBe(80);
  });

  it("a low fresh score still loses to a high stale one — decay narrows the gap, doesn't invert it", () => {
    const staleHigh = recommendedRankingKey(90, daysAgo(FLOOR_DAYS), FLOOR_DAYS, NOW); // 90 - 30 = 60
    const freshLow = recommendedRankingKey(50, daysAgo(0), FLOOR_DAYS, NOW); // 50
    expect(staleHigh).toBeGreaterThan(freshLow);
  });
});

/**
 * sortFeedResults — the fix for a real, live production bug: searching
 * "engineer" on the Recommended tab put a 99%-match "IT Administrator" (the
 * word appears nowhere in its title, company, or skill tags) ahead of
 * "Senior Backend Engineer" and "Data Engineer", because every tab's sort ran
 * unconditionally AFTER search_job_postings had already ranked results by
 * text relevance, throwing that ranking away in favor of match score.
 */
function scoredJob(overrides: {
  id: string;
  score: number;
  postedAt?: string;
  matchedSkills?: string[];
  missingSkills?: string[];
}): ScoredJob {
  return {
    job: { id: overrides.id, posted_at: overrides.postedAt ?? daysAgo(0) } as unknown as ScoredJob["job"],
    score: overrides.score,
    tier: "fair",
    explanation: {
      matchedSkills: overrides.matchedSkills ?? [],
      missingSkills: overrides.missingSkills ?? [],
      seniorityAlignment: "unknown",
    },
  };
}

describe("sortFeedResults", () => {
  // The exact reported shape: a search-RPC-ranked order where the real title
  // match ("Senior Backend Engineer") already sits first, and an unrelated
  // posting ("IT Administrator") that merely scores well against this resume
  // sits second — search_job_postings put them in this order on purpose.
  function searchRankedOrder(): ScoredJob[] {
    return [
      scoredJob({ id: "backend-engineer", score: 25 }), // real title match, low score
      scoredJob({ id: "it-administrator", score: 99 }), // no title/skill/company match, high score
    ];
  }

  it(
    "SABOTAGE-PROOF TARGET: with a search term active, a real title match is not " +
      "displaced by an unrelated high score, on Recommended",
    () => {
      const scored = searchRankedOrder();
      sortFeedResults(scored, "recommended", true, FLOOR_DAYS);
      expect(scored.map((s) => s.job.id)).toEqual(["backend-engineer", "it-administrator"]);
    },
  );

  it("same protection on External and Saved — they share Recommended's discarded-ranking bug", () => {
    for (const tab of ["external", "saved"]) {
      const scored = searchRankedOrder();
      sortFeedResults(scored, tab, true, FLOOR_DAYS);
      expect(scored.map((s) => s.job.id), `tab=${tab}`).toEqual(["backend-engineer", "it-administrator"]);
    }
  });

  it("Most Recent's existing behavior is unchanged — it already skipped this sort before the fix", () => {
    const scored = searchRankedOrder();
    sortFeedResults(scored, "recent", true, FLOOR_DAYS);
    expect(scored.map((s) => s.job.id)).toEqual(["backend-engineer", "it-administrator"]);
  });

  it("WITHOUT a search term, Recommended still sorts by score (existing behavior preserved)", () => {
    const scored = searchRankedOrder(); // same input, no search this time
    sortFeedResults(scored, "recommended", false, FLOOR_DAYS);
    // No q: score wins as it always did — the 99% posting moves back to first.
    expect(scored.map((s) => s.job.id)).toEqual(["it-administrator", "backend-engineer"]);
  });

  it("WITHOUT a search term, External/Saved still sort by plain score (existing behavior preserved)", () => {
    const scored = searchRankedOrder();
    sortFeedResults(scored, "external", false, FLOOR_DAYS);
    expect(scored.map((s) => s.job.id)).toEqual(["it-administrator", "backend-engineer"]);
  });

  it("zero-screenable-skill partitioning (#313) still holds when there's no search term", () => {
    const scored = [
      scoredJob({ id: "unscreened", score: 55 }), // no tags at all
      scoredJob({ id: "measured", score: 25, matchedSkills: ["sql"], missingSkills: ["aws", "docker"] }),
    ];
    sortFeedResults(scored, "recommended", false, FLOOR_DAYS);
    // Higher raw score, but unscreened — must still sort after the measured one.
    expect(scored.map((s) => s.job.id)).toEqual(["measured", "unscreened"]);
  });
});
