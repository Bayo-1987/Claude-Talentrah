/**
 * VERIFY-1 Phase 0a: "a stored null score means a mentor reviewed it" is only a safe rule if an AI review can never be stored as verified with a null score.
 * This file is the proof, from the code, and keeps it true:
 *
 *   1. The grader (verification.ts) turns whatever the model returned into a number: a missing score is 0, a non-numeric one is NaN, and NaN is never >= the
 *      pass mark. So `passed` implies an integer from 70 to 100.
 *   2. The AI runner hands exactly that score and that `passed` to resolve_talent_verification, and the mentor path hands null. Those are the only two callers.
 *   3. resolve_talent_verification (0135, 0142) writes status 'verified' only when p_verified is true.
 * So: verified + AI => a number. verified + null => mentor. Since 0234 the database applies this rule once, for both employer reads, and answers with a review
 * type (tests/talent-directory/review-type-0234.test.ts pins that); anything that cannot be shown to be one or the other (a missing value) is labelled with no
 * method at all.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const llm = vi.hoisted(() => ({ reply: "" }));
vi.mock("@/lib/llm", () => ({ generateWithFailover: async () => llm.reply }));
vi.mock("server-only", () => ({}));

const { gradeResumeForVerification, VERIFICATION_PASS_THRESHOLD } = await import("@/lib/talent-directory/verification");
const resume = { summary: "x", experience: [], education: [], skills: [] } as never;

const grade = async (reply: unknown) => {
  llm.reply = typeof reply === "string" ? reply : JSON.stringify(reply);
  return gradeResumeForVerification(resume);
};

describe("the grader never produces a pass without a real score", () => {
  it.each([
    ["a normal score", { score: 87 }, 87, true],
    ["exactly the pass mark", { score: 70 }, 70, true],
    ["just under it", { score: 69 }, 69, false],
    ["a missing score", {}, 0, false],
    ["a null score", { score: null }, 0, false],
    ["above 100", { score: 250 }, 100, true],
    ["below 0", { score: -5 }, 0, false],
    ["a decimal that rounds up to the mark", { score: 69.6 }, 70, true],
  ])("%s", async (_label, reply, score, passed) => {
    const g = await grade(reply);
    expect(g.score).toBe(score);
    expect(g.passed).toBe(passed);
  });

  it("a score that is not a number is NaN, and NaN is not a pass", async () => {
    const g = await grade({ score: "excellent" });
    expect(Number.isNaN(g.score)).toBe(true);
    expect(g.passed).toBe(false);
  });

  it("whatever the model returns, a pass is always an integer from the pass mark to 100", async () => {
    for (const reply of [{ score: 87 }, {}, { score: null }, { score: "x" }, { score: 1e9 }, { score: -1e9 }, { score: 70.4 }, { score: "88" }, { score: true }, { score: [] }]) {
      const g = await grade(reply);
      if (g.passed) {
        expect(Number.isInteger(g.score)).toBe(true);
        expect(g.score).toBeGreaterThanOrEqual(VERIFICATION_PASS_THRESHOLD);
        expect(g.score).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("only two places can mark a profile verified, and they hand over a score and null respectively", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const walk = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir)).flatMap((n) => {
      const rel = path.join(dir, n);
      return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(n) ? [rel] : [];
    });

  it("resolve_talent_verification is called from exactly the AI runner and the mentor runner", () => {
    const callers = walk("src")
      .filter((f) => !f.endsWith("supabase/types.ts"))
      .filter((f) => /rpc\(\s*"resolve_talent_verification"/.test(readFileSync(path.join(ROOT, f), "utf8")))
      .sort();
    expect(callers).toEqual(["src/lib/talent-directory/reviewer-runner.ts", "src/lib/talent-directory/verification-runner.ts"]);
  });

  it("the AI runner passes the grade's own score and pass flag, and nothing else", () => {
    const src = readFileSync(path.join(ROOT, "src/lib/talent-directory/verification-runner.ts"), "utf8");
    expect(src).toMatch(/p_verified: grade\.passed,\s*p_score: grade\.score,/);
  });

  it("the mentor runner passes a null score, always", () => {
    const src = readFileSync(path.join(ROOT, "src/lib/talent-directory/reviewer-runner.ts"), "utf8");
    expect(src).toMatch(/p_score: null as never,/);
  });

  it("the profile is marked verified only when p_verified is true (0142: v_new_status)", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/0142_talent_directory_human_review.sql"), "utf8");
    expect(sql).toMatch(/v_new_status text := case when p_verified then 'verified' else 'rejected' end;/);
    expect(sql).toMatch(/talent_verification_status = v_new_status,\s*talent_verification_score = p_score,/);
  });
});
