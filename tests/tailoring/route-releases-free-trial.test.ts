/**
 * TAILOR-RACE-1 — the route gives back a free trial it claimed when the run does not complete.
 *
 * checkTailoringAllowance now CLAIMS the one-time free trial before the model runs (tests/tailoring/free-trial-claim.test.ts). So every path out of the route between the check and the commit has to
 * give a claimed trial back, or a failed generation would burn it: the model failing (502), the cover-letter check failing for a reason other than credits, or anything unexpected thrown in between.
 * A completed run keeps its claim (the commit stands) and never releases. Mocked at the module boundary like tests/tailoring/route-credits-balance.test.ts: a test of the route's control flow.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chainable } from "../credits/chainable";

const checkTailoringAllowance = vi.fn();
const commitTailoringAllowance = vi.fn();
const tailorResumeToJob = vi.fn();

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
vi.mock("@/lib/tailoring/tailor", () => ({ tailorResumeToJob: (...a: unknown[]) => tailorResumeToJob(...a) }));
vi.mock("@/lib/courses/recommend", () => ({ recommendCoursesForGapAnalysis: async () => [] }));
vi.mock("@/lib/tailoring/gate", () => ({
  checkTailoringAllowance: (...a: unknown[]) => checkTailoringAllowance(...a),
  commitTailoringAllowance: (...a: unknown[]) => commitTailoringAllowance(...a),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));

const { POST } = await import("@/app/api/tailoring/route");

const JD = "We are hiring a backend engineer to build and operate payment APIs at scale. ".repeat(2);
const GOOD = { tailoredResume: {}, coverLetter: "A cover letter.", gapAnalysis: {}, structuredJd: { title: "Backend Engineer" }, proposedAdditions: [] };
const freeClaim = () => ({ isFreeTrial: true, isPassCovered: false, creditsSpent: 0, creditsAvailableAtCheck: 0, release: vi.fn(async () => undefined) });
const paid = () => ({ isFreeTrial: false, isPassCovered: false, creditsSpent: 20, creditsAvailableAtCheck: 60 });
const post = (includeCoverLetter: boolean) =>
  POST(new Request("http://localhost/api/tailoring", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jdText: JD, includeCoverLetter }) }));

beforeEach(() => {
  checkTailoringAllowance.mockReset();
  commitTailoringAllowance.mockReset().mockResolvedValue({ balanceAfter: null });
  tailorResumeToJob.mockReset().mockResolvedValue(GOOD);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("a claimed free trial is given back when the run does not complete", () => {
  it("the model fails: 502, and the tailoring trial is released", async () => {
    const claim = freeClaim();
    checkTailoringAllowance.mockResolvedValue(claim);
    tailorResumeToJob.mockRejectedValue(new Error("provider down"));
    const res = await post(false);
    expect(res.status).toBe(502);
    expect(claim.release).toHaveBeenCalledTimes(1);
    expect(commitTailoringAllowance).not.toHaveBeenCalled();
  });
  it("the model fails with both trials claimed: both are released", async () => {
    const t = freeClaim();
    const c = freeClaim();
    checkTailoringAllowance.mockResolvedValueOnce(t).mockResolvedValueOnce(c);
    tailorResumeToJob.mockRejectedValue(new Error("provider down"));
    expect((await post(true)).status).toBe(502);
    expect(t.release).toHaveBeenCalledTimes(1);
    expect(c.release).toHaveBeenCalledTimes(1);
  });
  it("the cover-letter check throws something other than 'not enough credits': the tailoring trial already claimed is released, and the error still surfaces", async () => {
    const t = freeClaim();
    checkTailoringAllowance.mockResolvedValueOnce(t).mockRejectedValueOnce(new Error("profile read failed"));
    await expect(post(true)).rejects.toThrow("profile read failed");
    expect(t.release).toHaveBeenCalledTimes(1);
    expect(tailorResumeToJob).not.toHaveBeenCalled();
  });
  it("a paid allowance has nothing to release and the failure path does not break on that", async () => {
    checkTailoringAllowance.mockResolvedValue(paid());
    tailorResumeToJob.mockRejectedValue(new Error("provider down"));
    expect((await post(false)).status).toBe(502);
  });
});

describe("a run that completes keeps its claim", () => {
  it("the trial is committed and never released", async () => {
    const claim = freeClaim();
    checkTailoringAllowance.mockResolvedValue(claim);
    const res = await post(false);
    expect(res.status).toBe(200);
    expect(commitTailoringAllowance).toHaveBeenCalledTimes(1);
    expect(claim.release).not.toHaveBeenCalled();
  });
});
