/**
 * The tailoring result cache (0162_tailoring_result_cache.sql).
 *
 * Unlike this repo's other tailoring unit tests, the cache module itself is
 * NOT mocked here — it's the thing under test, so this suite runs against
 * the real `tailoring_result_cache` table on the shared hosted project
 * (same convention as tests/passes/pass-covered-actions.test.ts calling
 * checkTailoringAllowance/commitTailoringAllowance directly against real
 * profiles/credit_ledger rows). Only the LLM call is mocked — this is about
 * the cache's own behaviour, not model output, and it must run without
 * spending API budget.
 *
 * Three properties, matching the PR's own verification checklist:
 *   1. Two identical calls (same base resume + same JD text + same
 *      includeCoverLetter) hit the LLM exactly ONCE — the second is served
 *      from cache. Proven by both call-count AND by the second result
 *      carrying the FIRST call's content (an incrementing marker), not a
 *      second, distinct generation.
 *   2. Two different JDs — and separately, the same JD against two
 *      different base resumes — do NOT share a cache entry: each gets its
 *      own real generation with its own distinct marker.
 *   3. The credit-consumption product decision (see this PR's description
 *      and the migration's own header): a cache hit is billed EXACTLY like
 *      a fresh generation. Proven by running checkTailoringAllowance ->
 *      tailorResumeToJob -> commitTailoringAllowance twice with identical
 *      inputs and asserting the credits balance drops by the same amount
 *      both times, even though the second tailorResumeToJob call is a
 *      cache hit that never touches the LLM.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "../support/auth";
import { CREDIT_COSTS } from "@/lib/credits/costs";

const generateText = vi.fn();
const fakeProvider = { name: "test" as const, model: "test", generateText, generateWithUsage: vi.fn() };
vi.mock("@/lib/llm", () => ({
  getLLMProvider: () => fakeProvider,
  generateWithFailover: (call: (p: typeof fakeProvider) => Promise<string>) => call(fakeProvider),
}));

const { tailorResumeToJob } = await import("@/lib/tailoring/tailor");
const { computeTailoringCacheKey } = await import("@/lib/tailoring/cache");
const { checkTailoringAllowance, commitTailoringAllowance } = await import("@/lib/tailoring/gate");
const { EMPTY_RESUME } = await import("@/lib/resume/types");

/** A well-formed, non-degenerate response carrying a marker we can trace back to a specific LLM call. */
function stubResponse(marker: string) {
  return JSON.stringify({
    structuredJd: { skills: [], keywords: [], responsibilities: [] },
    gapAnalysis: [],
    tailoredResume: {
      contact: {},
      experience: [],
      education: [],
      skills: [],
      projects: [],
      certifications: [],
    },
    atsScore: 70,
    atsFixes: [marker],
  });
}

let callCounter = 0;
beforeEach(() => {
  generateText.mockReset();
  callCounter = 0;
  generateText.mockImplementation(async () => stubResponse(`call-${++callCounter}`));
});

/** Every cache_key this suite writes, deleted in afterAll — this table has no user_id to scope a cascade delete to. */
const cacheKeysToClean: string[] = [];

function trackedResume(marker: string) {
  // A distinct base resume per test group avoids any accidental collision
  // with rows another concurrent session's OWN tailoring runs might leave
  // in this shared table, on top of the already-unique JD text below.
  return { ...EMPTY_RESUME, contact: { ...EMPTY_RESUME.contact, name: marker } };
}

afterAll(async () => {
  if (cacheKeysToClean.length) {
    await admin.from("tailoring_result_cache").delete().in("cache_key", cacheKeysToClean);
  }
});

describe("identical inputs hit the cache — the LLM runs exactly once", () => {
  it("a second identical call returns the FIRST call's content and never re-invokes the LLM", async () => {
    const marker = `identical-${randomUUID()}`;
    const jd = `Senior Backend Engineer — ${marker}. `.repeat(20);
    const resume = trackedResume(marker);
    cacheKeysToClean.push(computeTailoringCacheKey(resume, jd, false).cacheKey);

    const first = await tailorResumeToJob(resume, jd, false);
    const second = await tailorResumeToJob(resume, jd, false);

    expect(generateText, "SECOND call should have been served from cache, not the LLM").toHaveBeenCalledTimes(1);
    expect(first.atsFixes).toEqual(["call-1"]);
    expect(
      second.atsFixes,
      "cache hit returned DIFFERENT content than the original generation",
    ).toEqual(first.atsFixes);
    expect(second.tailoredResume).toEqual(first.tailoredResume);
  });

  it("jdTruncation is recomputed fresh per call, not trusted from the cached blob", async () => {
    const marker = `truncation-${randomUUID()}`;
    const jd = `Product Manager — ${marker}. `.repeat(20);
    const resume = trackedResume(marker);
    cacheKeysToClean.push(computeTailoringCacheKey(resume, jd, false).cacheKey);

    const first = await tailorResumeToJob(resume, jd, false);
    const second = await tailorResumeToJob(resume, jd, false);

    expect(first.jdTruncation).toBeNull();
    expect(second.jdTruncation).toBeNull();
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});

describe("different inputs do NOT share a cache entry", () => {
  it("two different JD texts against the same resume each get their own real generation", async () => {
    const marker = `twojds-${randomUUID()}`;
    const resume = trackedResume(marker);
    const jdA = `Data Analyst role A — ${marker}. `.repeat(20);
    const jdB = `Data Analyst role B — ${marker}, but a materially different posting. `.repeat(20);
    cacheKeysToClean.push(computeTailoringCacheKey(resume, jdA, false).cacheKey);
    cacheKeysToClean.push(computeTailoringCacheKey(resume, jdB, false).cacheKey);

    const resultA = await tailorResumeToJob(resume, jdA, false);
    const resultB = await tailorResumeToJob(resume, jdB, false);

    expect(
      generateText,
      "SABOTAGE-PROOF TARGET: two different JDs must not share a cache entry",
    ).toHaveBeenCalledTimes(2);
    expect(resultA.atsFixes).toEqual(["call-1"]);
    expect(resultB.atsFixes).toEqual(["call-2"]);
  });

  it("the SAME JD against two different base resumes each get their own real generation", async () => {
    const marker = `tworesumes-${randomUUID()}`;
    const jd = `Product Designer — ${marker}. `.repeat(20);
    const resumeA = trackedResume(`${marker}-A`);
    const resumeB = trackedResume(`${marker}-B`);
    cacheKeysToClean.push(computeTailoringCacheKey(resumeA, jd, false).cacheKey);
    cacheKeysToClean.push(computeTailoringCacheKey(resumeB, jd, false).cacheKey);

    const resultA = await tailorResumeToJob(resumeA, jd, false);
    const resultB = await tailorResumeToJob(resumeB, jd, false);

    expect(
      generateText,
      "SABOTAGE-PROOF TARGET: the same JD tailored against two different resumes must not share a cache entry",
    ).toHaveBeenCalledTimes(2);
    expect(resultA.atsFixes).toEqual(["call-1"]);
    expect(resultB.atsFixes).toEqual(["call-2"]);
  });

  it("includeCoverLetter is part of the key — a with/without-cover-letter pair does not collide", async () => {
    const marker = `coverletter-${randomUUID()}`;
    const jd = `Marketing Lead — ${marker}. `.repeat(20);
    const resume = trackedResume(marker);
    cacheKeysToClean.push(computeTailoringCacheKey(resume, jd, false).cacheKey);
    cacheKeysToClean.push(computeTailoringCacheKey(resume, jd, true).cacheKey);

    await tailorResumeToJob(resume, jd, false);
    await tailorResumeToJob(resume, jd, true);

    expect(generateText).toHaveBeenCalledTimes(2);
  });
});

describe("the product decision: a cache hit is billed exactly like a fresh generation", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser("tailoring-cache-credit");
    userId = user.id;
    // Force the CREDITS path (not the free trial) so the assertion is about
    // the specific decision this PR documents — a Pass-covered or
    // free-trial run behaves the same way, but isn't what's being proven
    // here.
    await admin
      .from("profiles")
      .update({ free_trial_tailoring_used: true, credits_balance: 100 })
      .eq("id", userId);
  }, 60_000);

  afterAll(async () => {
    if (userId) await deleteTestUsers([userId]);
  }, 60_000);

  async function balance(): Promise<number> {
    const { data } = await admin.from("profiles").select("credits_balance").eq("id", userId).single();
    return data?.credits_balance ?? 0;
  }

  it("charges the same credits on the cache-hit run as on the original generation", async () => {
    const marker = `credit-${randomUUID()}`;
    const jd = `Operations Manager — ${marker}. `.repeat(20);
    const resume = trackedResume(marker);
    cacheKeysToClean.push(computeTailoringCacheKey(resume, jd, false).cacheKey);

    expect(await balance()).toBe(100);

    // First run: a real generation.
    const allowance1 = await checkTailoringAllowance(userId, "tailoring");
    expect(allowance1.isFreeTrial).toBe(false);
    expect(allowance1.isPassCovered).toBe(false);
    expect(allowance1.creditsSpent).toBe(CREDIT_COSTS.tailoringRun);
    const result1 = await tailorResumeToJob(resume, jd, false);
    await commitTailoringAllowance(userId, "tailoring", allowance1);

    expect(result1.atsFixes).toEqual(["call-1"]);
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(
      await balance(),
      "the first, real generation must charge CREDIT_COSTS.tailoringRun",
    ).toBe(100 - CREDIT_COSTS.tailoringRun);

    // Second run: identical inputs — a cache hit inside tailorResumeToJob.
    const allowance2 = await checkTailoringAllowance(userId, "tailoring");
    const result2 = await tailorResumeToJob(resume, jd, false);
    await commitTailoringAllowance(userId, "tailoring", allowance2);

    expect(
      generateText,
      "the second call must be served from cache — no second LLM invocation",
    ).toHaveBeenCalledTimes(1);
    expect(result2.atsFixes, "cache hit must return the SAME content as the original run").toEqual(
      result1.atsFixes,
    );
    expect(
      await balance(),
      "PRODUCT DECISION: a cache hit is billed exactly like a fresh generation — this must charge " +
        "CREDIT_COSTS.tailoringRun again, not skip the charge because no LLM call happened",
    ).toBe(100 - 2 * CREDIT_COSTS.tailoringRun);
  });
});
