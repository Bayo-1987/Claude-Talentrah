/**
 * send-489 (issue #605) — POST /api/tailoring puts the account's NEW credit balance in its JSON, so the
 * masthead can update without a reload (tailor-form.tsx used to be a plain fetch with no refresh at all).
 *
 * The run commits up to TWO spends in sequence (the tailoring, then the cover letter). The balance the
 * client must see is the one the LAST spend left — the final ledger state — and a free-trial or Pass leg
 * contributes nothing, so "the last non-null balanceAfter" is the rule: tailoring paid (60) + cover letter
 * free-trial (null) → 60, not null; both paid (60 then 40) → 40.
 *
 * Mocked at the module boundary like tests/tailoring/malformed-body.test.ts: this is a test of the
 * route's own control flow, not of the gate or the LLM.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainable } from "../credits/chainable";

const checkTailoringAllowance = vi.fn();
const commitTailoringAllowance = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "route-user" } } }) },
    from: (table: string) => {
      if (table === "resumes") {
        // the base-resume read, and both result inserts (.insert().select().single())
        return chainable({ data: { structured_content: {} }, error: null }, { data: { id: "resume-1", structured_content: {} }, error: null });
      }
      return chainable({ data: null, error: null });
    },
  }),
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}));
vi.mock("@/lib/api/rate-limit", () => ({
  consumeRateLimit: async () => ({ allowed: true, used: 1, resetsAt: null }),
  rateLimited: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { tailoring: { limit: 10, windowSeconds: 3600 } },
}));
vi.mock("@/lib/tailoring/tailor", () => ({
  tailorResumeToJob: async () => ({
    tailoredResume: {},
    coverLetter: "A cover letter.",
    gapAnalysis: {},
    structuredJd: { title: "Backend Engineer" },
    proposedAdditions: [],
  }),
}));
vi.mock("@/lib/courses/recommend", () => ({ recommendCoursesForGapAnalysis: async () => [] }));
vi.mock("@/lib/tailoring/gate", () => ({
  checkTailoringAllowance: (...a: unknown[]) => checkTailoringAllowance(...a),
  commitTailoringAllowance: (...a: unknown[]) => commitTailoringAllowance(...a),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));

const { POST } = await import("@/app/api/tailoring/route");

const JD = "We are hiring a backend engineer to build and operate payment APIs at scale. ".repeat(2);
const allowance = (over: Record<string, unknown> = {}) => ({
  isFreeTrial: false,
  isPassCovered: false,
  creditsSpent: 20,
  creditsAvailableAtCheck: 60,
  ...over,
});

async function run(includeCoverLetter: boolean) {
  const res = await POST(
    new Request("http://localhost/api/tailoring", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jdText: JD, includeCoverLetter }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  checkTailoringAllowance.mockReset();
  commitTailoringAllowance.mockReset();
});

describe("POST /api/tailoring — creditsBalance", () => {
  it("a paid tailoring with no cover letter reports the balance its spend left", async () => {
    checkTailoringAllowance.mockResolvedValue(allowance());
    commitTailoringAllowance.mockResolvedValue({ balanceAfter: 40 });
    expect((await run(false)).creditsBalance).toBe(40);
  });

  it("two paid legs report the balance the LAST spend left (the final ledger state)", async () => {
    checkTailoringAllowance.mockResolvedValueOnce(allowance()).mockResolvedValueOnce(allowance({ creditsSpent: 8 }));
    commitTailoringAllowance.mockResolvedValueOnce({ balanceAfter: 40 }).mockResolvedValueOnce({ balanceAfter: 32 });
    expect((await run(true)).creditsBalance).toBe(32);
  });

  it("a paid tailoring plus a free-trial cover letter still reports the tailoring's balance, not null", async () => {
    checkTailoringAllowance
      .mockResolvedValueOnce(allowance())
      .mockResolvedValueOnce(allowance({ isFreeTrial: true, creditsSpent: 0 }));
    commitTailoringAllowance.mockResolvedValueOnce({ balanceAfter: 40 }).mockResolvedValueOnce({ balanceAfter: null });
    expect((await run(true)).creditsBalance).toBe(40);
  });

  it("a free-trial run reports null: nothing was spent, so the masthead is left alone", async () => {
    checkTailoringAllowance.mockResolvedValue(allowance({ isFreeTrial: true, creditsSpent: 0 }));
    commitTailoringAllowance.mockResolvedValue({ balanceAfter: null });
    const json = await run(false);
    expect(json.creditsBalance).toBeNull();
    expect(json.isFreeTrial).toBe(true);
  });

  it("a Pass-covered run reports null", async () => {
    checkTailoringAllowance.mockResolvedValue(allowance({ isPassCovered: true, creditsSpent: 0 }));
    commitTailoringAllowance.mockResolvedValue({ balanceAfter: null });
    expect((await run(false)).creditsBalance).toBeNull();
  });

  it("tolerates a commit that returns nothing (treated as no balance change)", async () => {
    checkTailoringAllowance.mockResolvedValue(allowance({ isFreeTrial: true, creditsSpent: 0 }));
    commitTailoringAllowance.mockResolvedValue(undefined);
    expect((await run(false)).creditsBalance).toBeNull();
  });

  it("everything it returned before is still there", async () => {
    checkTailoringAllowance.mockResolvedValue(allowance());
    commitTailoringAllowance.mockResolvedValue({ balanceAfter: 40 });
    const json = await run(false);
    for (const key of ["resumeId", "coverLetterResumeId", "result", "isFreeTrial", "isPassCovered", "creditsSpent", "courseRecommendations"]) {
      expect(json, key).toHaveProperty(key);
    }
    expect(json.creditsSpent).toBe(20);
  });
});
