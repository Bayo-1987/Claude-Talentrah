/**
 * What the verification runner does with a FLAGGED resume (one whose text tries to instruct the grader: src/lib/talent-directory/injection-flags.ts).
 *
 * Nothing was graded, so nothing is charged. The attempt is still RECORDED, as a rejected verification with its feedback, so the attempt limit that counts a person's verification rows counts it too:
 * the row is resolved (resolve_talent_verification), not released (release_talent_verification_claim deletes the row, which is what a failed grading call does).
 *
 * Unit test with a fake service client and a fake grader: it needs no database. The concurrency of the claim step is tested separately (verification-race.test.ts, database-backed).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const spendCredits = vi.fn();
const grade = vi.fn();
const rpc = vi.fn();
const calls: string[] = [];
let balance = 100;

class InsufficientCreditsError extends Error {}
vi.mock("@/lib/credits/spend", () => ({ spendCredits, InsufficientCreditsError }));
vi.mock("@/lib/talent-directory/verification", () => ({ gradeResumeForVerification: grade, VERIFICATION_PASS_THRESHOLD: 70 }));

function chain(result: unknown) {
  const p: object = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return undefined;
      if (prop === "single" || prop === "maybeSingle") return async () => result;
      return () => p;
    },
  });
  return p;
}
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => ({
      update: () => {
        calls.push(`${table}.update`);
        return chain({ data: { id: "u1" }, error: null });
      },
      insert: () => {
        calls.push(`${table}.insert`);
        return chain({ data: { id: "v1" }, error: null });
      },
      select: () => {
        calls.push(`${table}.select`);
        return chain(table === "profiles" ? { data: { credits_balance: balance } } : { data: { structured_content: { summary: "x", skills: [], experience: [] } } });
      },
    }),
    rpc,
  }),
}));

const { runTalentVerification } = await import("@/lib/talent-directory/verification-runner");
const { CREDIT_COSTS } = await import("@/lib/credits/costs");

const FLAGGED = { score: 0, passed: false, flagged: true, feedback: "Your resume contains text that reads like instructions to the grader.", concerns: ["Found text that tells the grader what score to give."] };

beforeEach(() => {
  calls.length = 0;
  balance = 100;
  spendCredits.mockReset().mockResolvedValue(undefined);
  grade.mockReset();
  rpc.mockReset().mockResolvedValue({ data: true, error: null });
});

describe("a flagged resume", () => {
  it("is not charged, and no credit spend is even attempted", async () => {
    grade.mockResolvedValue(FLAGGED);
    await runTalentVerification("user-1");
    expect(spendCredits).not.toHaveBeenCalled();
  });

  it("is still recorded: the attempt row is RESOLVED as rejected with score 0 and the feedback, never released (a release deletes the row)", async () => {
    grade.mockResolvedValue(FLAGGED);
    await runTalentVerification("user-1");
    expect(calls).toContain("talent_verifications.insert");
    const resolve = rpc.mock.calls.filter((c) => c[0] === "resolve_talent_verification");
    expect(resolve).toHaveLength(1);
    expect(resolve[0][1]).toMatchObject({ p_verification_id: "v1", p_user_id: "user-1", p_verified: false, p_score: 0, p_feedback: FLAGGED.feedback });
    expect(rpc.mock.calls.filter((c) => c[0] === "release_talent_verification_claim")).toHaveLength(0);
  });

  it("answers as a normal not-verified outcome (success, passed false, score 0) and says plainly that nothing was charged", async () => {
    grade.mockResolvedValue(FLAGGED);
    const r = await runTalentVerification("user-1");
    expect(r).toMatchObject({ status: "success", passed: false, score: 0 });
    expect(r.message).toMatch(/haven't been charged|not charged|no credits/i);
    expect(r.message).toMatch(/instructions/i);
    expect(r.message).toMatch(/human review/i);
  });

  it("the stored feedback and the answer carry no attempt limit (none exists yet: 0b will add it)", async () => {
    grade.mockResolvedValue(FLAGGED);
    const r = await runTalentVerification("user-1");
    const stored = rpc.mock.calls.find((c) => c[0] === "resolve_talent_verification")?.[1]?.p_feedback as string;
    for (const text of [r.message, stored]) expect(text).not.toMatch(/per 30 days|30 days|attempts? (left|remaining)|limit|twice/i);
  });

  it("is never reported verified, even if a grade object said so (a flagged grade cannot pass)", async () => {
    grade.mockResolvedValue({ ...FLAGGED, passed: true });
    await runTalentVerification("user-1");
    const resolve = rpc.mock.calls.find((c) => c[0] === "resolve_talent_verification");
    expect(resolve?.[1]).toMatchObject({ p_verified: false });
  });
});

describe("everything else is unchanged", () => {
  it("a passing grade is charged once, with the verification id, and resolved verified", async () => {
    grade.mockResolvedValue({ score: 85, passed: true, feedback: "Solid.", concerns: [] });
    const r = await runTalentVerification("user-1");
    expect(spendCredits).toHaveBeenCalledTimes(1);
    expect(spendCredits).toHaveBeenCalledWith("user-1", CREDIT_COSTS.talentDirectoryVerification, "talent_directory_verification", "v1");
    expect(rpc.mock.calls.find((c) => c[0] === "resolve_talent_verification")?.[1]).toMatchObject({ p_verified: true, p_score: 85 });
    expect(r).toMatchObject({ status: "success", passed: true, score: 85 });
  });

  it("a low unflagged grade is still charged (a graded attempt costs credits, as before)", async () => {
    grade.mockResolvedValue({ score: 20, passed: false, feedback: "Too thin.", concerns: [] });
    await runTalentVerification("user-1");
    expect(spendCredits).toHaveBeenCalledTimes(1);
  });

  it("a grader that throws releases the claim, charges nothing, and records no result", async () => {
    grade.mockRejectedValue(new Error("model down"));
    const r = await runTalentVerification("user-1");
    expect(r.status).toBe("error");
    expect(spendCredits).not.toHaveBeenCalled();
    expect(rpc.mock.calls.filter((c) => c[0] === "release_talent_verification_claim")).toHaveLength(1);
    expect(rpc.mock.calls.filter((c) => c[0] === "resolve_talent_verification")).toHaveLength(0);
  });

  it("too few credits is refused before anything is graded, flagged or not (the balance check comes first, as before)", async () => {
    balance = 0;
    const r = await runTalentVerification("user-1");
    expect(r.status).toBe("error");
    expect(grade).not.toHaveBeenCalled();
    expect(spendCredits).not.toHaveBeenCalled();
  });
});
