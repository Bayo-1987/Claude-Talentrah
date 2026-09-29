/**
 * The pure decision rules behind send-467's win-back email — no database,
 * matching this repo's own standing convention (digest/select.test.ts,
 * proactive-match-alert-select.test.ts): the policy should be testable
 * without a database, and the wiring around it is tested separately with a
 * mocked service-role client (win-back-eligibility.test.ts).
 */
import { describe, expect, it } from "vitest";
import {
  MAX_WINBACK_EXAMPLES,
  MIN_WINBACK_POSTINGS,
  WINBACK_MAX_DAYS,
  WINBACK_MIN_DAYS,
  isEligibleForWinbackDedup,
  isWithinWinbackWindow,
  selectWinbackContent,
  winbackCandidateIsEligible,
  type WinbackCandidate,
  type WinbackMatchedPosting,
} from "@/lib/notifications/win-back/select";

const NOW = new Date("2026-09-26T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("isWithinWinbackWindow — the boundaries, exactly", () => {
  it("excludes 13 days (one short of the window)", () => {
    expect(isWithinWinbackWindow(daysAgo(13), NOW)).toBe(false);
  });

  it(`includes exactly ${WINBACK_MIN_DAYS} days (the lower bound)`, () => {
    expect(isWithinWinbackWindow(daysAgo(WINBACK_MIN_DAYS), NOW)).toBe(true);
  });

  it("includes a day in the middle of the window (18 days)", () => {
    expect(isWithinWinbackWindow(daysAgo(18), NOW)).toBe(true);
  });

  it(`includes exactly ${WINBACK_MAX_DAYS} days (the upper bound)`, () => {
    expect(isWithinWinbackWindow(daysAgo(WINBACK_MAX_DAYS), NOW)).toBe(true);
  });

  it("excludes 22 days (one past the window)", () => {
    expect(isWithinWinbackWindow(daysAgo(22), NOW)).toBe(false);
  });

  it("excludes a null last_active_at — no known episode start to measure from", () => {
    expect(isWithinWinbackWindow(null, NOW)).toBe(false);
  });
});

describe("isEligibleForWinbackDedup — once per dormancy episode", () => {
  it("is eligible with no prior win-back send at all", () => {
    expect(isEligibleForWinbackDedup(daysAgo(WINBACK_MIN_DAYS), null)).toBe(true);
  });

  it("is NOT eligible when already sent since this episode's last_active_at", () => {
    const lastActiveAt = daysAgo(WINBACK_MIN_DAYS);
    const sentAfterGoingDormant = daysAgo(1); // sent more recently than lastActiveAt
    expect(isEligibleForWinbackDedup(lastActiveAt, sentAfterGoingDormant)).toBe(false);
  });

  it("is eligible again once the user has been active since the last send (a NEW episode)", () => {
    const priorSend = daysAgo(40); // an old win-back email, from a past episode
    const lastActiveAt = daysAgo(WINBACK_MIN_DAYS); // active again since then, now dormant again
    expect(isEligibleForWinbackDedup(lastActiveAt, priorSend)).toBe(true);
  });
});

function candidate(over: Partial<WinbackCandidate> = {}): WinbackCandidate {
  return {
    userId: "user-1",
    email: "user1@example.test",
    firstName: "Ada",
    hasBaseResume: true,
    lastActiveAt: daysAgo(WINBACK_MIN_DAYS),
    lastWinbackSentAt: null,
    ...over,
  };
}

describe("winbackCandidateIsEligible — all three gates together", () => {
  it("is eligible with a base resume, inside the window, no prior send", () => {
    expect(winbackCandidateIsEligible(candidate(), NOW)).toBe(true);
  });

  it("is NOT eligible with no base resume", () => {
    expect(winbackCandidateIsEligible(candidate({ hasBaseResume: false }), NOW)).toBe(false);
  });

  it("is NOT eligible outside the window (too recently active)", () => {
    expect(winbackCandidateIsEligible(candidate({ lastActiveAt: daysAgo(5) }), NOW)).toBe(false);
  });

  it("is NOT eligible outside the window (gone too long — past day 21)", () => {
    expect(winbackCandidateIsEligible(candidate({ lastActiveAt: daysAgo(30) }), NOW)).toBe(false);
  });

  it("is NOT eligible with a null lastActiveAt", () => {
    expect(winbackCandidateIsEligible(candidate({ lastActiveAt: null }), NOW)).toBe(false);
  });

  it("is NOT eligible if already sent this episode", () => {
    expect(
      winbackCandidateIsEligible(
        candidate({ lastActiveAt: daysAgo(16), lastWinbackSentAt: daysAgo(2) }),
        NOW,
      ),
    ).toBe(false);
  });
});

function posting(over: Partial<WinbackMatchedPosting> = {}): WinbackMatchedPosting {
  return {
    jobId: "job-1",
    title: "Backend Engineer",
    companyName: "Acme",
    location: "Lagos",
    score: 80,
    ...over,
  };
}

describe("selectWinbackContent — the count and the capped examples", () => {
  it(`returns null with fewer than ${MIN_WINBACK_POSTINGS} matching posting`, () => {
    expect(selectWinbackContent([])).toBeNull();
  });

  it("reports the full count even when more than MAX_WINBACK_EXAMPLES exist", () => {
    const postings = [
      posting({ jobId: "a", score: 95, title: "A" }),
      posting({ jobId: "b", score: 90, title: "B" }),
      posting({ jobId: "c", score: 85, title: "C" }),
      posting({ jobId: "d", score: 80, title: "D" }),
      posting({ jobId: "e", score: 75, title: "E" }),
    ];
    const content = selectWinbackContent(postings);
    expect(content).not.toBeNull();
    expect(content!.totalCount).toBe(5);
    expect(content!.examples).toHaveLength(MAX_WINBACK_EXAMPLES);
    // Highest-scoring first.
    expect(content!.examples.map((p) => p.jobId)).toEqual(["a", "b", "c"]);
  });

  it("returns exactly the postings given when under the cap, count matching", () => {
    const postings = [posting({ jobId: "only-one", score: 72 })];
    const content = selectWinbackContent(postings);
    expect(content).not.toBeNull();
    expect(content!.totalCount).toBe(1);
    expect(content!.examples).toHaveLength(1);
  });
});
