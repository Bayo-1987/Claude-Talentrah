/**
 * TAILOR-RACE-2 (QA, P3): with a used trial and credit for exactly one run, simultaneous requests gave one 200 and the rest an EMPTY 500. The paid check only reads the balance; the atomic spend happens at
 * the COMMIT, after the model ran, and the loser's spend threw InsufficientCreditsError out of the route (uncaught): LLM cost spent, nothing delivered, no explanation. (No double charge: the spend itself is atomic.)
 *
 * The commit's shortfall is now answered like the check's: the tailoring leg's shortfall is a 402 with the normal message (nothing was charged, nothing is delivered, any free-trial claim is given back);
 * the cover-letter leg's shortfall delivers the tailored resume without the letter (the same behaviour as the check-time shortfall), charging only the tailoring. Mocked at the module boundary like
 * tests/tailoring/route-releases-free-trial.test.ts. NOT done here: charging BEFORE the model (the LLM run for a loser is still spent): that needs a way to give credits back, and the ledger has none.
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
vi.mock("@/lib/api/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/rate-limit")>()),
  consumeRateLimit: async () => ({ allowed: true, used: 1, resetsAt: null }),
}));
vi.mock("@/lib/tailoring/tailor", () => ({ tailorResumeToJob: (...a: unknown[]) => tailorResumeToJob(...a) }));
vi.mock("@/lib/courses/recommend", () => ({ recommendCoursesForGapAnalysis: async () => [] }));
vi.mock("@/lib/tailoring/gate", () => ({
  checkTailoringAllowance: (...a: unknown[]) => checkTailoringAllowance(...a),
  commitTailoringAllowance: (...a: unknown[]) => commitTailoringAllowance(...a),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {},
}));

const { POST } = await import("@/app/api/tailoring/route");
const { InsufficientCreditsError } = await import("@/lib/tailoring/gate");

const JD = "We are hiring a backend engineer to build and operate payment APIs at scale. ".repeat(2);
const GOOD = { tailoredResume: {}, coverLetter: "A cover letter.", gapAnalysis: {}, structuredJd: { title: "Backend Engineer" }, proposedAdditions: [] };
const paid = (cost = 20) => ({ isFreeTrial: false, isPassCovered: false, creditsSpent: cost, creditsAvailableAtCheck: 20 });
const freeClaim = () => ({ isFreeTrial: true, isPassCovered: false, creditsSpent: 0, creditsAvailableAtCheck: 0, release: vi.fn(async () => undefined) });
const post = (includeCoverLetter: boolean) =>
  POST(new Request("http://localhost/api/tailoring", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jdText: JD, includeCoverLetter }) }));
const shortfall = () => new InsufficientCreditsError(20, 0);

beforeEach(() => {
  checkTailoringAllowance.mockReset();
  commitTailoringAllowance.mockReset();
  tailorResumeToJob.mockReset().mockResolvedValue(GOOD);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("the tailoring commit finds the credits gone (a simultaneous request spent them)", () => {
  it("answers 402 with the normal message and needsCredits, not an empty 500", async () => {
    checkTailoringAllowance.mockResolvedValue(paid());
    commitTailoringAllowance.mockRejectedValue(shortfall());
    const res = await post(false);
    expect(res.status).toBe(402);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.needsCredits).toBe(true);
    expect(String(json.error)).toMatch(/credits/i);
    expect(json).not.toHaveProperty("resumeId");
  });
  it("gives back a free cover-letter trial it had claimed", async () => {
    const letter = freeClaim();
    checkTailoringAllowance.mockResolvedValueOnce(paid()).mockResolvedValueOnce(letter);
    commitTailoringAllowance.mockRejectedValueOnce(shortfall());
    expect((await post(true)).status).toBe(402);
    expect(letter.release).toHaveBeenCalledTimes(1);
  });
  it("any other commit error is still an error (it is not swallowed as a shortfall)", async () => {
    checkTailoringAllowance.mockResolvedValue(paid());
    commitTailoringAllowance.mockRejectedValue(new Error("ledger down"));
    await expect(post(false)).rejects.toThrow("ledger down");
  });
});

describe("the cover-letter commit finds the credits gone", () => {
  it("the tailored resume is still delivered, without the letter, and only the tailoring is charged", async () => {
    const letter = paid(8);
    checkTailoringAllowance.mockResolvedValueOnce(paid()).mockResolvedValueOnce(letter);
    commitTailoringAllowance.mockResolvedValueOnce({ balanceAfter: 40 }).mockRejectedValueOnce(shortfall());
    const res = await post(true);
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.coverLetterResumeId).toBeNull();
    expect(json.creditsSpent).toBe(20);
    expect(json.creditsBalance).toBe(40);
  });
});
