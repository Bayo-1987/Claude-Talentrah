/**
 * The pure decision rules behind send-138's proactive "exceptional match"
 * alert — no database, matching this repo's own standing convention for the
 * digest (tests/digest/select.test.ts): the policy should be testable
 * without a database, and the wiring around it is tested separately with a
 * mocked service-role client (proactive-match-alert-gates.test.ts,
 * proactive-match-alert-eligibility.test.ts).
 */
import { describe, expect, it } from "vitest";
import {
  NOT_ACTIVELY_SEARCHING_DAYS,
  RATE_LIMIT_DAYS,
  candidateIsEligible,
  isExcellentMatch,
  isNotActivelySearching,
  isWithinRateLimit,
  pickBestJobForCandidate,
  type ProactiveAlertCandidate,
  type ScoredNewJob,
} from "@/lib/notifications/proactive-match-alert/select";

const NOW = new Date("2026-09-10T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("isNotActivelySearching — the definition, stated as a threshold", () => {
  it("treats no match_scores row at all as not actively searching", () => {
    expect(isNotActivelySearching(null, NOW)).toBe(true);
  });

  it(`is true at exactly ${NOT_ACTIVELY_SEARCHING_DAYS} days since last activity`, () => {
    expect(isNotActivelySearching(daysAgo(NOT_ACTIVELY_SEARCHING_DAYS), NOW)).toBe(true);
  });

  it("is false one day inside the threshold — a genuinely recent visit", () => {
    expect(isNotActivelySearching(daysAgo(NOT_ACTIVELY_SEARCHING_DAYS - 1), NOW)).toBe(false);
  });

  it("is false for someone who visited today", () => {
    expect(isNotActivelySearching(daysAgo(0), NOW)).toBe(false);
  });
});

describe("isWithinRateLimit — at least one week between alerts", () => {
  it("is false when never alerted before", () => {
    expect(isWithinRateLimit(null, NOW)).toBe(false);
  });

  it(`is true for an alert sent under ${RATE_LIMIT_DAYS} days ago — the case a second Excellent match must not double-fire on`, () => {
    expect(isWithinRateLimit(daysAgo(RATE_LIMIT_DAYS - 1), NOW)).toBe(true);
  });

  it(`is false at exactly ${RATE_LIMIT_DAYS} days — the interval has fully elapsed`, () => {
    expect(isWithinRateLimit(daysAgo(RATE_LIMIT_DAYS), NOW)).toBe(false);
  });

  it("is false for an alert sent well outside the window", () => {
    expect(isWithinRateLimit(daysAgo(RATE_LIMIT_DAYS + 10), NOW)).toBe(false);
  });
});

describe("isExcellentMatch — reuses the system's own tier boundary", () => {
  it("is true at and above 80", () => {
    expect(isExcellentMatch(80)).toBe(true);
    expect(isExcellentMatch(95)).toBe(true);
  });

  it("is false for a Good or Fair score, even a high Good", () => {
    expect(isExcellentMatch(79)).toBe(false);
    expect(isExcellentMatch(70)).toBe(false);
    expect(isExcellentMatch(50)).toBe(false);
  });
});

describe("candidateIsEligible — the three independent gates on ONE candidate", () => {
  const base = (over: Partial<ProactiveAlertCandidate> = {}): ProactiveAlertCandidate => ({
    userId: "user-1",
    email: "seeker@example.test",
    firstName: "Ada",
    hasBaseResume: true,
    lastActiveAt: null,
    lastAlertSentAt: null,
    ...over,
  });

  it("is eligible with no resume-blocking, activity, or rate-limit issue", () => {
    expect(candidateIsEligible(base(), NOW)).toBe(true);
  });

  it("is NOT eligible without a base resume — nothing to score against", () => {
    expect(candidateIsEligible(base({ hasBaseResume: false }), NOW)).toBe(false);
  });

  it("is NOT eligible for an actively-searching user (recent match_scores activity)", () => {
    expect(candidateIsEligible(base({ lastActiveAt: daysAgo(1) }), NOW)).toBe(false);
  });

  it("is NOT eligible while rate-limited by a recent alert", () => {
    expect(candidateIsEligible(base({ lastAlertSentAt: daysAgo(1) }), NOW)).toBe(false);
  });

  it("is eligible again once BOTH the activity window and the rate limit have elapsed", () => {
    expect(
      candidateIsEligible(
        base({
          lastActiveAt: daysAgo(NOT_ACTIVELY_SEARCHING_DAYS + 1),
          lastAlertSentAt: daysAgo(RATE_LIMIT_DAYS + 1),
        }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe("pickBestJobForCandidate — one alert, the strongest match, never a list", () => {
  const job = (over: Partial<ScoredNewJob> = {}): ScoredNewJob => ({
    jobId: "job-1",
    title: "Role",
    companyName: "Co",
    location: null,
    score: 85,
    ...over,
  });

  it("returns null when nothing scored Excellent", () => {
    expect(pickBestJobForCandidate([job({ score: 79 }), job({ score: 60 })])).toBeNull();
  });

  it("returns the single highest-scoring Excellent match among several", () => {
    const best = pickBestJobForCandidate([
      job({ jobId: "a", score: 82 }),
      job({ jobId: "b", score: 96 }),
      job({ jobId: "c", score: 88 }),
    ]);
    expect(best?.jobId).toBe("b");
  });

  it("ignores a Good match sitting alongside an Excellent one", () => {
    const best = pickBestJobForCandidate([job({ jobId: "good", score: 74 }), job({ jobId: "excellent", score: 91 })]);
    expect(best?.jobId).toBe("excellent");
  });
});
