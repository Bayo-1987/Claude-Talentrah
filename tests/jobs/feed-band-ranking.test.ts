/**
 * send-5xx (draft) — the feed orders by DISPLAY BAND, then evidence, then the displayed score, never by the raw score.
 *
 * WHAT PRODUCTION SHOWED (S3-24, two different accounts with identical top recommendations): the Recommended tab sorted by
 * the RAW score minus a freshness penalty. A thin match (1 or 2 screenable tags) scores a raw 100 whenever the resume
 * covers its one or two generic tags, and shows as 79 because of the thin cap, but it sorted by the 100. So eight
 * thin matches (generic tags: project management, aws, azure, sql, agile) floated above the only two well-evidenced jobs
 * (raw 72 and 55). "Thin" should mean LESS confident, so it must rank lower, not higher.
 *
 * THE ORDER (the owner's design):
 *   1. display band: Excellent (displayed 80+), then Good (60-79), then Fair (under 60), then unscreened (0 tags) last;
 *   2. within a band: well-evidenced (3+ screenable tags) before thin (1-2);
 *   3. then the DISPLAYED (capped) score with the Recommended freshness penalty;
 *   4. then tag count, descending, as the tie-break.
 * A well-evidenced Fair job never outranks a thin Good one (the band comes first); a thin 79 never outranks a
 * well-evidenced job in the same band (evidence comes second).
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

  it("eight thin raw-100s do not bury the two well-evidenced jobs below them", () => {
    const thin = Array.from({ length: 8 }, (_, i) => job(`thin-${i}`, 100, 1));
    const result = order([...thin, job("evidenced-72", 72, 3), job("evidenced-65", 65, 5)]);
    expect(result.slice(0, 2)).toEqual(["evidenced-72", "evidenced-65"]);
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

  it("Fair means displayed under 60", () => {
    expect(order([job("fair-59", 59, 4), job("good-60", 60, 4)])).toEqual(["good-60", "fair-59"]);
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
