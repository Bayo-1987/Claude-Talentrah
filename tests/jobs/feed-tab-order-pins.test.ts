/**
 * Each feed tab's order, pinned on one fixed set, so any change to it is deliberate (owner's request with the band ranking).
 *
 * Which tabs sort by match at all: Recommended, External and Saved's open postings (all three went through the score sort
 * before the band change, so the bands apply to exactly those); Most Recent sorts by posted_at upstream and never calls
 * this sort. Saved's closed/snapshot entries are a separate list in the saved-row order and are not touched here.
 *
 * ONE DELIBERATE CONSEQUENCE of "band first", written down rather than left to be discovered: the Stage 12 freshness
 * penalty now orders jobs only WITHIN a displayed tier and evidence tier. Before, a stale non-thin 100 (28 days old) lost to a fresh
 * 75 on Recommended; now an Excellent non-thin job outranks any Good one however old it is (within the 30-day window), which
 * is what "bands first" means. A freshness-over-band rule would be a different design.
 */
import { describe, expect, it } from "vitest";
import { sortFeedResults } from "@/lib/jobs/ranking";
import type { ScoredJob } from "@/lib/matching/compute-and-store";

const NOW = new Date("2026-10-02T12:00:00Z").getTime();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();

const mk = (id: string, score: number, tags: number, age: number): ScoredJob =>
  ({
    job: { id, posted_at: daysAgo(age) } as unknown as ScoredJob["job"],
    score,
    tier: "fair",
    explanation: { matchedSkills: Array.from({ length: tags }, (_, i) => `${id}-${i}`), missingSkills: [], seniorityAlignment: "unknown" },
  }) as ScoredJob;

/** Input order is deliberately scrambled. All evidenced (4 tags) except the last two. */
const fixture = () => [
  mk("good-72-fresh", 72, 4, 0),
  mk("excellent-90-stale", 90, 4, 25),
  mk("fair-65-fresh", 65, 4, 0),
  mk("thin-100-fresh", 100, 1, 0),
  mk("unscreened-100", 100, 0, 0),
  mk("none-50-fresh", 50, 4, 0),
];

const run = (tab: string) => {
  const jobs = fixture();
  sortFeedResults(jobs, tab, false, 30);
  return jobs.map((j) => j.job.id);
};

describe("tab order on the pinned fixture", () => {
  // S3-51: the band is the DISPLAYED tier (Excellent 80+, Good 70-79, Fair 60-69, then no tier under 60). A thin raw-100 displays 79, which is Good, so it
  // sorts above an evidenced 65, which is Fair; before, both sat in one "60-79" band and the evidenced 65 came first. The names below are the badge's.
  it("recommended: Excellent, then Good (evidenced before thin), then Fair, then no tier, unscreened last", () => {
    expect(run("recommended")).toEqual([
      "excellent-90-stale",
      "good-72-fresh",
      "thin-100-fresh",
      "fair-65-fresh",
      "none-50-fresh",
      "unscreened-100",
    ]);
  });

  it("external and saved: the same bands without the freshness penalty", () => {
    const expected = ["excellent-90-stale", "good-72-fresh", "thin-100-fresh", "fair-65-fresh", "none-50-fresh", "unscreened-100"];
    expect(run("external")).toEqual(expected);
    expect(run("saved")).toEqual(expected);
  });

  it("recent: untouched (input order; it is sorted by posted_at upstream)", () => {
    expect(run("recent")).toEqual(fixture().map((j) => j.job.id));
  });

  it("the freshness penalty now only decides ties of band and evidence: a stale evidenced 72 loses to a fresh evidenced 72 on Recommended, not on External", () => {
    const rec = [mk("stale-72", 72, 4, 25), mk("fresh-72", 72, 4, 0)];
    sortFeedResults(rec, "recommended", false, 30);
    expect(rec.map((j) => j.job.id)).toEqual(["fresh-72", "stale-72"]);
    const ext = [mk("stale-72", 72, 4, 25), mk("fresh-72", 72, 4, 0)];
    sortFeedResults(ext, "external", false, 30);
    // Equal displayed score and tags on External: input order stands (a stable sort), no freshness there.
    expect(ext.map((j) => j.job.id)).toEqual(["stale-72", "fresh-72"]);
  });
});
