/**
 * send-5xx (draft) — the feed orders by DISPLAY BAND, then evidence, then the displayed score, never by the raw score.
 *
 * WHAT PRODUCTION SHOWED (S3-24, two different accounts with identical top recommendations): the Recommended tab sorted by
 * the RAW score minus a freshness penalty. A thin match (1 or 2 screenable tags) scores a raw 100 whenever the resume
 * covers its one or two generic tags, and shows as 79 because of the thin cap, but it sorted by the 100. So eight
 * thin matches (generic tags: project management, aws, azure, sql, agile) floated above the only two well-evidenced jobs
 * (raw 72 and 55). "Thin" should mean LESS confident, so it must rank lower, not higher.
 *
 * THE ORDER (the owner's design, corrected by S3-51):
 *   1. the DISPLAYED TIER, exactly the badge the card shows: Excellent (80+), Good (70-79), Fair (60-69), then no tier (under 60),
 *      then unscreened (0 tags) last. A higher tier NEVER sorts below a lower one, whatever the evidence or freshness;
 *   2. within a tier: well-evidenced (3+ screenable tags) before thin (1-2);
 *   3. then the DISPLAYED (capped) score with the Recommended freshness penalty;
 *   4. then tag count, descending, as the tie-break.
 * S3-51: the band used to be "Good = displayed 60-79", which merged the Fair tier (60-69) into Good, so a 67% Fair with three tags
 * sorted above six 79% Good matches on the owner's feed. The band is now the tier the badge shows, so the order and the label agree.
 */
import { describe, expect, it } from "vitest";
import { sortFeedResults } from "@/lib/jobs/ranking";
import type { ScoredJob } from "@/lib/matching/compute-and-store";

const NOW = new Date("2026-10-02T12:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();
const FLOOR = 30;

let seq = 0;
/** `tags` screenable tags, all of them matched (a thin/non-thin set is decided by the COUNT, not by coverage). */
function job(id: string, score: number, tags: number, postedAt = daysAgo(1)): ScoredJob {
  seq++;
  return {
    job: { id, posted_at: postedAt, source_type: "external" } as unknown as ScoredJob["job"],
    score,
    tier: "fair",
    explanation: {
      matchedSkills: Array.from({ length: tags }, (_, i) => `tag-${seq}-${i}`),
      missingSkills: [],
      seniorityAlignment: "unknown",
    },
  };
}
const order = (jobs: ScoredJob[], tab = "recommended") => {
  sortFeedResults(jobs, tab, false, FLOOR);
  return jobs.map((j) => j.job.id);
};

describe("a thin match ranks below a well-evidenced one in the same band", () => {
  it("THE REPORTED CASE: a thin raw-100 (displays 79) does not outrank a well-evidenced 72 (Good)", () => {
    expect(order([job("thin-100", 100, 1), job("evidenced-72", 72, 4)])).toEqual(["evidenced-72", "thin-100"]);
  });

  it("eight thin raw-100s do not bury the well-evidenced job of THEIR tier (a Good 72 stays above the thin Good 79s)", () => {
    const thin = Array.from({ length: 8 }, (_, i) => job(`thin-${i}`, 100, 1));
    const result = order([...thin, job("evidenced-72", 72, 3), job("evidenced-65", 65, 5)]);
    expect(result[0]).toBe("evidenced-72");
    // S3-51: the evidenced 65 is a FAIR (60-69), a lower tier than the thin Good 79s, so it ranks below them, not above.
    expect(result.at(-1)).toBe("evidenced-65");
  });
});

describe("the band comes first", () => {
  it("a well-evidenced Fair job never outranks a thin Good one", () => {
    expect(order([job("evidenced-fair-55", 55, 5), job("thin-good", 100, 1)])).toEqual(["thin-good", "evidenced-fair-55"]);
  });

  it("a well-evidenced Excellent job outranks everything below it", () => {
    expect(order([job("thin-79", 100, 2), job("good-72", 72, 4), job("excellent-90", 90, 4)])).toEqual([
      "excellent-90",
      "good-72",
      "thin-79",
    ]);
  });

  it("the tiers are the badge's: Good is 70-79, Fair is 60-69, and under 60 has no tier", () => {
    expect(order([job("fair-69", 69, 4), job("good-70", 70, 4)])).toEqual(["good-70", "fair-69"]);
    expect(order([job("none-59", 59, 4), job("fair-60", 60, 4)])).toEqual(["fair-60", "none-59"]);
  });
});

describe("S3-51: the band is the DISPLAYED TIER, so a Fair never outranks a Good", () => {
  it("THE REPORTED CASE (production, 2026-10-03): a 67% Fair with 3 tags sorts below the 79% Good matches with 1 tag", () => {
    const goods = ["a", "b", "c", "d", "e", "f"].map((id) => job(`thin-good-${id}`, 100, 1));
    const result = order([job("systems-analyst-67", 67, 3), ...goods]);
    expect(result.at(-1)).toBe("systems-analyst-67");
    expect(result.slice(0, 6).every((id) => id.startsWith("thin-good-"))).toBe(true);
  });

  it("the boundary: a thin 70 (Good) outranks a well-evidenced 69 (Fair), and a well-evidenced 69 outranks a thin 60 only within Fair", () => {
    expect(order([job("evidenced-69", 69, 6), job("thin-70", 70, 1)])).toEqual(["thin-70", "evidenced-69"]);
    expect(order([job("thin-60", 60, 1), job("evidenced-69", 69, 6)])).toEqual(["evidenced-69", "thin-60"]);
  });

  it("a Fair outranks a job with no tier (under 60) even when the no-tier job is better evidenced and fresher", () => {
    expect(order([job("fresh-none-55", 55, 8, daysAgo(0)), job("stale-fair-60", 60, 1, daysAgo(25))])).toEqual(["stale-fair-60", "fresh-none-55"]);
  });

  it("PROPERTY: over every score 0-100, thin and evidenced, fresh and stale, a higher DISPLAYED tier never sorts below a lower one", () => {
    const tierRank = (displayed: number) => (displayed >= 80 ? 0 : displayed >= 70 ? 1 : displayed >= 60 ? 2 : 3);
    const jobs: ScoredJob[] = [];
    for (const score of [0, 30, 55, 59, 60, 64, 69, 70, 74, 79, 80, 85, 99, 100]) {
      for (const tags of [1, 2, 3, 6]) {
        for (const age of [0, 12, 28]) jobs.push(job(`s${score}-t${tags}-d${age}`, score, tags, daysAgo(age)));
      }
    }
    const sorted = [...jobs];
    sortFeedResults(sorted, "recommended", false, FLOOR);
    // the DISPLAYED score of a thin job is its score capped at 79 (src/lib/match-tier.ts describeMatchConfidence)
    const displayed = (j: ScoredJob) => {
      const tags = j.explanation.matchedSkills.length;
      return tags <= 2 ? Math.min(j.score, 79) : j.score;
    };
    const ranks = sorted.map((j) => tierRank(displayed(j)));
    for (let i = 1; i < ranks.length; i++) expect(ranks[i], `${sorted[i - 1].job.id} before ${sorted[i].job.id}`).toBeGreaterThanOrEqual(ranks[i - 1]);
  });
});

describe("it sorts by the DISPLAYED score, not the raw one", () => {
  it("two thin jobs that both DISPLAY 79 (raw 100 and raw 85) are ordered by freshness, not by raw", () => {
    const stale100 = job("thin-raw-100-stale", 100, 1, daysAgo(25));
    const fresh85 = job("thin-raw-85-fresh", 85, 1, daysAgo(0));
    expect(order([stale100, fresh85])).toEqual(["thin-raw-85-fresh", "thin-raw-100-stale"]);
  });

  it("a thin job's 79 ties a well-evidenced 79's displayed score and still loses on evidence", () => {
    // Both show 79; the evidenced one is not thin, so it sorts first in the band.
    expect(order([job("thin-79", 100, 1), job("evidenced-79", 79, 4)])).toEqual(["evidenced-79", "thin-79"]);
  });
});

describe("ties", () => {
  it("two jobs at the same displayed score order by evidence (more screenable tags first)", () => {
    expect(order([job("two-tags-72", 72, 2), job("four-tags-72", 72, 4)])).toEqual(["four-tags-72", "two-tags-72"]);
  });

  it("two well-evidenced jobs at the same displayed score order by tag count", () => {
    expect(order([job("three-72", 72, 3), job("six-72", 72, 6)])).toEqual(["six-72", "three-72"]);
  });
});

describe("unscreened jobs are always last", () => {
  it("a raw-100 job with no screenable tags sorts after a thin Fair one", () => {
    expect(order([job("unscreened-100", 100, 0), job("thin-fair-40", 40, 2)])).toEqual(["thin-fair-40", "unscreened-100"]);
  });
});

describe("the same ordering on External and Saved (they sort by match too)", () => {
  for (const tab of ["external", "saved"]) {
    it(`${tab}: thin raw-100 below a well-evidenced 72`, () => {
      expect(order([job("thin-100", 100, 1), job("evidenced-72", 72, 4)], tab)).toEqual(["evidenced-72", "thin-100"]);
    });
  }
});

describe("what does not change", () => {
  it("a search term still skips the sort entirely (the RPC's text ranking stands)", () => {
    const jobs = [job("a", 10, 4), job("b", 99, 4)];
    sortFeedResults(jobs, "recommended", true, FLOOR);
    expect(jobs.map((j) => j.job.id)).toEqual(["a", "b"]);
  });

  it("Most Recent is untouched", () => {
    const jobs = [job("a", 10, 4), job("b", 99, 4)];
    sortFeedResults(jobs, "recent", false, FLOOR);
    expect(jobs.map((j) => j.job.id)).toEqual(["a", "b"]);
  });
});
