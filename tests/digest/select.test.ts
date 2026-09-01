/**
 * What goes in a digest, and — more importantly — when nothing does.
 *
 * ── THE CADENCE THESE RULES ASSUME, AND THE DATA BEHIND IT ────────────────
 *
 * Weekly, measured against production rather than picked: over 30 days the
 * board took 107 new postings — mean 3.6 a day, and SEVEN of those days took
 * none at all. Nearly one day in four has nothing new before per-user match
 * filtering runs. A daily digest would be mostly silence with an occasional
 * single job, which is how an email channel gets ignored.
 *
 * The silence rule below is the same argument at per-user scale: a week with
 * one mediocre match should produce no email, not a thin one.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_JOBS,
  MIN_DIGEST_SCORE,
  MIN_JOBS,
  selectDigestJobs,
  type DigestCandidate,
} from "@/lib/digest/select";

let n = 0;
const candidate = (over: Partial<DigestCandidate> = {}): DigestCandidate => ({
  jobId: `job-${n++}`,
  title: `Role ${n}`,
  companyName: "Zaria Digital",
  location: "Lagos, Nigeria",
  score: 85,
  postedAt: "2026-08-28T09:00:00.000Z",
  alreadyActedOn: false,
  ...over,
});

describe("silence is a valid outcome", () => {
  it("sends nothing when there are no candidates", () => {
    expect(selectDigestJobs([])).toEqual([]);
  });

  it(`sends nothing below ${MIN_JOBS} qualifying jobs`, () => {
    /*
     * The rule the whole feature's credibility rests on. An email saying "here
     * is one thing you might like" is worse than no email: it spends the
     * channel and teaches people the digest is not worth opening.
     */
    expect(selectDigestJobs([candidate({ score: 95 })])).toEqual([]);
  });

  it("sends nothing when everything is below the score floor", () => {
    const weak = [candidate({ score: 69 }), candidate({ score: 40 }), candidate({ score: 12 })];
    expect(selectDigestJobs(weak)).toEqual([]);
  });

  it("sends nothing when the only good matches were already acted on", () => {
    const seen = [candidate({ alreadyActedOn: true }), candidate({ alreadyActedOn: true })];
    expect(selectDigestJobs(seen)).toEqual([]);
  });
});

describe("what qualifies", () => {
  it(`admits ${MIN_DIGEST_SCORE} and rejects one below it`, () => {
    // The boundary itself: 70 is Good, 69 is Fair, and Fair does not earn an
    // email. An off-by-one here changes what the product claims a match is.
    const out = selectDigestJobs([
      candidate({ score: MIN_DIGEST_SCORE }),
      candidate({ score: MIN_DIGEST_SCORE }),
      candidate({ score: MIN_DIGEST_SCORE - 1 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((j) => j.score >= MIN_DIGEST_SCORE)).toBe(true);
  });

  it("labels each job with the shared tier vocabulary, never its own", () => {
    const out = selectDigestJobs([candidate({ score: 92 }), candidate({ score: 74 })]);
    expect(out.map((j) => j.tier)).toEqual(["excellent", "good"]);
    // Fair can never appear: it is below the floor by construction.
    expect(out.some((j) => j.tier === "fair")).toBe(false);
  });

  it("drops anything already saved or applied to", () => {
    const out = selectDigestJobs([
      candidate({ jobId: "seen", alreadyActedOn: true }),
      candidate({ jobId: "a" }),
      candidate({ jobId: "b" }),
    ]);
    expect(out.map((j) => j.jobId)).toEqual(["a", "b"]);
  });
});

describe("ordering and size", () => {
  it("leads with the strongest match", () => {
    const out = selectDigestJobs([
      candidate({ score: 71, jobId: "weak" }),
      candidate({ score: 97, jobId: "strong" }),
      candidate({ score: 84, jobId: "mid" }),
    ]);
    expect(out.map((j) => j.jobId)).toEqual(["strong", "mid", "weak"]);
  });

  it(`never sends more than ${MAX_JOBS}`, () => {
    const many = Array.from({ length: 30 }, (_, i) => candidate({ score: 80 + (i % 15) }));
    expect(selectDigestJobs(many)).toHaveLength(MAX_JOBS);
  });

  it("capping cannot take a qualifying week below the silence floor", () => {
    // Guards an ordering mistake: applying MIN_JOBS before the cap would be
    // equivalent, applying the cap to a value below MIN_JOBS would not.
    const many = Array.from({ length: 30 }, () => candidate({ score: 90 }));
    expect(selectDigestJobs(many).length).toBeGreaterThanOrEqual(MIN_JOBS);
  });
});
