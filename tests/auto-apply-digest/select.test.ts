/**
 * What goes in the Auto-Apply proof-of-work digest, and when nothing does.
 *
 * ── WHY THE SILENCE RULE HERE IS NARROWER THAN THE MATCH DIGEST'S ──────────
 *
 * selectDigestJobs (src/lib/digest/select.ts) skips a week below MIN_JOBS
 * because a thin recommendation list reads as the product not having much
 * to say. This is a report of what Farah already did, not a ranked
 * recommendation list — a week where exactly one application was queued is
 * still a fact worth reporting. The only silence condition here is
 * "genuinely nothing happened at all".
 */
import { describe, expect, it } from "vitest";
import { describeMatchConfidence } from "@/lib/match-tier";
import {
  MAX_HIGHLIGHTS,
  selectAutoApplyDigestSummary,
  type AutoApplyQueueEntryLike,
} from "@/lib/auto-apply-digest/select";

const WINDOW_START = new Date("2026-09-01T00:00:00.000Z");
const WINDOW_END = new Date("2026-09-08T00:00:00.000Z");
const IN_WINDOW = "2026-09-03T12:00:00.000Z";
const BEFORE_WINDOW = "2026-08-20T12:00:00.000Z";
const AFTER_WINDOW = "2026-09-10T12:00:00.000Z";

let n = 0;
const entry = (over: Partial<AutoApplyQueueEntryLike> = {}): AutoApplyQueueEntryLike => ({
  status: "pending",
  queuedAt: IN_WINDOW,
  jobTitle: `Role ${n++}`,
  companyName: "Zaria Digital",
  score: 88,
  explanation: { matchedSkills: ["sql", "python", "aws", "docker", "kubernetes"], missingSkills: [] },
  ...over,
});

describe("silence is a valid outcome", () => {
  it("sends nothing for an empty list", () => {
    expect(selectAutoApplyDigestSummary([], WINDOW_START, WINDOW_END)).toBeNull();
  });

  it("sends nothing when every entry is outside the window", () => {
    const out = [
      entry({ queuedAt: BEFORE_WINDOW, status: "submitted" }),
      entry({ queuedAt: AFTER_WINDOW, status: "submitted" }),
    ];
    expect(selectAutoApplyDigestSummary(out, WINDOW_START, WINDOW_END)).toBeNull();
  });

  it("does NOT stay silent for a single queued application — unlike the match digest, one is worth reporting", () => {
    const summary = selectAutoApplyDigestSummary([entry()], WINDOW_START, WINDOW_END);
    expect(summary).not.toBeNull();
    expect(summary!.queued).toBe(1);
  });
});

describe("counts", () => {
  it("buckets a mixed week correctly", () => {
    const entries = [
      entry({ status: "submitted" }),
      entry({ status: "submitted" }),
      entry({ status: "submitted" }),
      entry({ status: "handed_off" }),
      entry({ status: "dismissed" }),
      entry({ status: "expired" }),
      entry({ status: "pending" }),
    ];
    const summary = selectAutoApplyDigestSummary(entries, WINDOW_START, WINDOW_END)!;
    expect(summary.queued).toBe(7);
    expect(summary.submitted).toBe(3);
    expect(summary.handedOff).toBe(1);
    expect(summary.dismissed).toBe(1);
    expect(summary.expired).toBe(1);
  });

  it("excludes out-of-window entries from every count", () => {
    const entries = [
      entry({ status: "submitted" }),
      entry({ status: "submitted", queuedAt: BEFORE_WINDOW }),
      entry({ status: "dismissed", queuedAt: AFTER_WINDOW }),
    ];
    const summary = selectAutoApplyDigestSummary(entries, WINDOW_START, WINDOW_END)!;
    expect(summary.queued).toBe(1);
    expect(summary.submitted).toBe(1);
    expect(summary.dismissed).toBe(0);
  });
});

describe("highlights", () => {
  it("draws only from submitted/handed_off entries, never pending/dismissed/expired", () => {
    const entries = [
      entry({ status: "submitted", jobTitle: "Backend Engineer" }),
      entry({ status: "handed_off", jobTitle: "Data Analyst" }),
      entry({ status: "pending", jobTitle: "Should Not Appear (pending)" }),
      entry({ status: "dismissed", jobTitle: "Should Not Appear (dismissed)" }),
      entry({ status: "expired", jobTitle: "Should Not Appear (expired)" }),
    ];
    const summary = selectAutoApplyDigestSummary(entries, WINDOW_START, WINDOW_END)!;
    const titles = summary.highlights.map((h) => h.jobTitle);
    expect(titles).toContain("Backend Engineer");
    expect(titles).toContain("Data Analyst");
    for (const bad of ["Should Not Appear (pending)", "Should Not Appear (dismissed)", "Should Not Appear (expired)"]) {
      expect(titles).not.toContain(bad);
    }
  });

  it(`never exceeds MAX_HIGHLIGHTS (${MAX_HIGHLIGHTS})`, () => {
    const entries = Array.from({ length: 10 }, () => entry({ status: "submitted" }));
    const summary = selectAutoApplyDigestSummary(entries, WINDOW_START, WINDOW_END)!;
    expect(summary.highlights.length).toBe(MAX_HIGHLIGHTS);
  });

  it("leads with the most recently queued", () => {
    const entries = [
      entry({ status: "submitted", jobTitle: "Oldest", queuedAt: "2026-09-01T00:00:00.000Z" }),
      entry({ status: "submitted", jobTitle: "Newest", queuedAt: "2026-09-06T00:00:00.000Z" }),
      entry({ status: "submitted", jobTitle: "Middle", queuedAt: "2026-09-03T00:00:00.000Z" }),
    ];
    const summary = selectAutoApplyDigestSummary(entries, WINDOW_START, WINDOW_END)!;
    expect(summary.highlights.map((h) => h.jobTitle)).toEqual(["Newest", "Middle", "Oldest"]);
  });

  it("the tier label comes from describeMatchConfidence, never a hand-built string", () => {
    const richExplanation = { matchedSkills: ["sql", "python", "aws", "docker", "kubernetes"], missingSkills: [] };
    const summary = selectAutoApplyDigestSummary(
      [entry({ status: "submitted", score: 92, explanation: richExplanation })],
      WINDOW_START,
      WINDOW_END,
    )!;
    const expected = describeMatchConfidence(92, richExplanation);
    expect(summary.highlights[0].tier).toBe(expected.label);
  });

  it("a thin-tag match is still correctly labeled (capped), not printed as a bare 'Excellent'", () => {
    const thinExplanation = { matchedSkills: ["project management"], missingSkills: [] };
    const summary = selectAutoApplyDigestSummary(
      [entry({ status: "submitted", score: 99, explanation: thinExplanation })],
      WINDOW_START,
      WINDOW_END,
    )!;
    const expected = describeMatchConfidence(99, thinExplanation);
    expect(summary.highlights[0].tier).toBe(expected.label);
    expect(summary.highlights[0].tier).toContain("thin match");
  });
});
