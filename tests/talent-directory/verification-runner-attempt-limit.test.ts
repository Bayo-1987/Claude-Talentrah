/**
 * What the verification runner does with the answers of claim_ai_talent_verification (the one database call that claims the profile, enforces the limit of two AI reviews per person per rolling 30 days
 * and inserts the pending row). The limit itself is held by tests/talent-directory/ai-verification-attempt-limit.test.ts against the real database; this file holds what the runner does when the
 * database says no, or says something it cannot use: it refuses BEFORE anything is graded, charged, resolved or released, and it fails closed.
 *
 * Unit test with a fake service client and a fake grader: it needs no database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const spendCredits = vi.fn();
const grade = vi.fn();
const rpc = vi.fn();
const fromCalls: string[] = [];

class InsufficientCreditsError extends Error {}
vi.mock("@/lib/credits/spend", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/credits/spend")>()), spendCredits, InsufficientCreditsError }));
vi.mock("@/lib/talent-directory/verification", () => ({ gradeResumeForVerification: grade, VERIFICATION_PASS_THRESHOLD: 70 }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      fromCalls.push(table);
      throw new Error(`the limit path must not touch ${table}`);
    },
    rpc,
  }),
}));

const { runTalentVerification, attemptLimitMessage } = await import("@/lib/talent-directory/verification-runner");

function claimReturns(row: Record<string, unknown> | null, error: unknown = null) {
  rpc.mockImplementation(async (name: string) => (name === "claim_ai_talent_verification" ? { data: row ? [row] : [], error } : { data: true, error: null }));
}

function expectNothingElseHappened() {
  expect(grade).not.toHaveBeenCalled();
  expect(spendCredits).not.toHaveBeenCalled();
  expect(rpc.mock.calls.map((c) => c[0])).toEqual(["claim_ai_talent_verification"]);
  expect(fromCalls).toEqual([]);
}

beforeEach(() => {
  fromCalls.length = 0;
  spendCredits.mockReset();
  grade.mockReset();
  rpc.mockReset();
});

describe("the limit is reached", () => {
  const LIMIT = { ok: false, verification_id: null, reason: "limit_reached", next_allowed_at: "2026-10-31T16:34:11.561Z" };

  it("is refused before grading, charging, resolving or releasing anything", async () => {
    claimReturns(LIMIT);
    const r = await runTalentVerification("user-1");
    expect(r.status).toBe("error");
    expectNothingElseHappened();
  });

  it("says, word for word: both reviews by Farah (AI) used in the past 30 days, the date the next one opens, and a review by a Talentrah mentor (which has no such limit), in the words of the Resume reviewed by … badge", async () => {
    claimReturns(LIMIT);
    const r = await runTalentVerification("user-1");
    expect(r.message).toBe(
      "You've used both of your resume reviews by Farah (AI) in the past 30 days. The next one opens on 31 Oct 2026. If you'd rather not wait, you can ask a Talentrah mentor to review your resume.",
    );
  });

  it("uses none of the words the copy scan forbids (no verified / verification / verify)", async () => {
    claimReturns(LIMIT);
    const r = await runTalentVerification("user-1");
    expect(r.message).not.toMatch(/verif(?:ied|ication|ications|y|ying)/i);
  });

  it("gives the date in UTC, so it does not depend on the server's time zone", () => {
    expect(attemptLimitMessage("2026-10-31T23:30:00Z")).toContain("31 Oct 2026");
    expect(attemptLimitMessage("2026-11-01T00:30:00Z")).toContain("1 Nov 2026");
  });

  it("leaves the date out rather than inventing one when the database gave none or an unreadable one", () => {
    for (const bad of [null, undefined, "", "not a date"]) {
      const m = attemptLimitMessage(bad);
      expect(m).not.toMatch(/opens on/);
      expect(m).toContain("both of your resume reviews");
      expect(m).toContain("Talentrah mentor");
    }
  });
});

describe("every other answer is refused before anything else happens", () => {
  it("not_claimable (a review is pending or the resume was already reviewed): the existing message, nothing graded or charged", async () => {
    claimReturns({ ok: false, verification_id: null, reason: "not_claimable", next_allowed_at: null });
    const r = await runTalentVerification("user-1");
    expect(r).toEqual({ status: "error", message: "A resume review is already pending, or your resume has already been reviewed." });
    expectNothingElseHappened();
  });

  it("no_profile: the generic message, and nothing graded or charged (fails closed)", async () => {
    claimReturns({ ok: false, verification_id: null, reason: "no_profile", next_allowed_at: null });
    const r = await runTalentVerification("user-1");
    expect(r).toEqual({ status: "error", message: "Something went wrong on our end." });
    expectNothingElseHappened();
  });

  it("a database error: the generic message, nothing graded or charged", async () => {
    claimReturns(null, { message: "boom" });
    const r = await runTalentVerification("user-1");
    expect(r).toEqual({ status: "error", message: "Something went wrong on our end." });
    expectNothingElseHappened();
  });

  it("an error that arrives together with an ok row is still refused (an error is never a yes)", async () => {
    claimReturns({ ok: true, verification_id: "v1", reason: null, next_allowed_at: null }, { message: "boom" });
    const r = await runTalentVerification("user-1");
    expect(r).toEqual({ status: "error", message: "Something went wrong on our end." });
    expectNothingElseHappened();
  });

  it("an empty answer: refused (an answer that cannot be read is never a yes)", async () => {
    claimReturns(null);
    const r = await runTalentVerification("user-1");
    expect(r.status).toBe("error");
    expectNothingElseHappened();
  });

  it("ok with no verification id: refused, nothing graded (it cannot be resolved or released without an id)", async () => {
    claimReturns({ ok: true, verification_id: null, reason: null, next_allowed_at: null });
    const r = await runTalentVerification("user-1");
    expect(r.status).toBe("error");
    expectNothingElseHappened();
  });

  it("an unknown reason with ok false: refused, not treated as a limit message", async () => {
    claimReturns({ ok: false, verification_id: null, reason: "something_new", next_allowed_at: null });
    const r = await runTalentVerification("user-1");
    expect(r).toEqual({ status: "error", message: "Something went wrong on our end." });
    expectNothingElseHappened();
  });
});
