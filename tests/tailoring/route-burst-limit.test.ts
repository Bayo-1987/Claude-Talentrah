/**
 * TAILOR-RACE-2, the part we can do without a ledger change: bound how many model runs one user can START at once.
 *
 * The paid check only reads the balance and the atomic spend happens after the model ran, so N simultaneous requests with credit for ONE run still start N model runs (the losers get a 402 AFTER the cost).
 * Paying first would need a way to give credits back, which the ledger lacks. Instead a short burst window in front of the existing hourly limit (RATE_LIMITS.tailoringBurst: 2 requests per 15 seconds, per
 * user) lets at most two requests through, however many arrive together; the rest get a 429 before any work. The hourly cap of 10 still applies behind it. A button that disables while pending, a retry after a
 * failure and a double click all fit inside two; three starts in 15 seconds is not ordinary use. Mocked at the module boundary; the counter is atomic like the real one (0038).
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
const buckets = vi.hoisted(() => ({ counts: new Map<string, number>(), limits: { tailoringBurst: 2, tailoring: 10 } as Record<string, number> }));
vi.mock("@/lib/api/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/rate-limit")>()),
  // Same contract as consume_rate_limit (0038): one atomic increment per call, allowed while the count is within the limit; every call counts, allowed or not.
  consumeRateLimit: async (userId: string, bucket: string) => {
    const key = `${userId}:${bucket}`;
    const used = (buckets.counts.get(key) ?? 0) + 1;
    buckets.counts.set(key, used);
    return { allowed: used <= (buckets.limits[bucket] ?? 10), used, resetsAt: null };
  },
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
const GOOD = { tailoredResume: {}, coverLetter: null, gapAnalysis: {}, structuredJd: { title: "Backend Engineer" }, proposedAdditions: [] };
const paid = () => ({ isFreeTrial: false, isPassCovered: false, creditsSpent: 20, creditsAvailableAtCheck: 20 });
const post = () =>
  POST(new Request("http://localhost/api/tailoring", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jdText: JD, includeCoverLetter: false }) }));

beforeEach(() => {
  buckets.counts.clear();
  checkTailoringAllowance.mockReset().mockResolvedValue(paid());
  commitTailoringAllowance.mockReset().mockResolvedValue({ balanceAfter: 0 });
  tailorResumeToJob.mockReset().mockImplementation(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return GOOD;
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("a burst from one user", () => {
  it("six simultaneous requests: at most two reach the model, the other four are refused with a 429 before any work", async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => post()));
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 429)).toHaveLength(4);
    expect(statuses.filter((s) => s === 200)).toHaveLength(2);
    expect(tailorResumeToJob).toHaveBeenCalledTimes(2);
    expect(checkTailoringAllowance).toHaveBeenCalledTimes(2);
  });
  it("a refused request says what is happening, in the body the form shows", async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, () => post()));
    const refused = responses.filter((r) => r.status === 429);
    expect(refused.length).toBeGreaterThan(0);
    const body = (await refused[0].json()) as { error: string };
    expect(body.error).toMatch(/already in progress/i);
    expect(body.error).not.toMatch(/a lot of requests/i);
  });
  it("the hourly cap keeps its own, generic message", async () => {
    buckets.limits.tailoringBurst = 1000;
    buckets.limits.tailoring = 0;
    const res = await post();
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toMatch(/a lot of requests/i);
    buckets.limits.tailoringBurst = 2;
    buckets.limits.tailoring = 10;
  });
  it("one request, a double click (two), and a retry after one failure all pass", async () => {
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    expect(tailorResumeToJob).toHaveBeenCalledTimes(2);
  });
  it("a refused request does not use up the hourly allowance (the burst check comes first)", async () => {
    await Promise.all(Array.from({ length: 6 }, () => post()));
    expect(buckets.counts.get("route-user:tailoring")).toBe(2);
    expect(buckets.counts.get("route-user:tailoringBurst")).toBe(6);
  });
});

describe("the limit itself", () => {
  it("is pinned: 2 requests per 15 seconds, per user, in front of the hourly cap", async () => {
    const { RATE_LIMITS } = await vi.importActual<typeof import("@/lib/api/rate-limit")>("@/lib/api/rate-limit");
    expect(RATE_LIMITS.tailoringBurst).toEqual({ limit: 2, windowSeconds: 15 });
    expect(RATE_LIMITS.tailoring).toEqual({ limit: 10, windowSeconds: 3600 });
  });
});
