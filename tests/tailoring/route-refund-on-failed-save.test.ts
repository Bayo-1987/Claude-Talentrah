/**
 * TAILORING-SAVE-REFUND-1: /api/tailoring commits each leg's allowance (a paid spend, the free-trial flag, a Pass-covered event) BEFORE it saves the result. A failed save, or a throw at the letter leg, used to leave
 * every committed leg standing: credits taken for nothing, a free trial burned (a retry then fell to the PAID branch), a Pass fair-use slot used. Now each committed leg is recorded; a failure before the save gives a paid leg's
 * credits back (grantCredits, same reason as the spend), sets a free-trial flag back, and writes no Pass event (the event is written only after the save). A leg is returned once only (the grant has no idempotency key).
 *
 * The REAL gate and route run. Faked: the two Supabase clients (an in-memory profiles table with the same conditional-update semantics as tests/tailoring/free-trial-claim.test.ts, and the resumes inserts), the ledger
 * (a spend/grant fake that keeps a balance and a row list, so a retry's net charge can be summed), the gate-event writer, the model.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CREDIT_COSTS } from "@/lib/credits/costs";

const world = vi.hoisted(() => ({
  profile: {} as Record<string, unknown>,
  ledger: [] as { delta: number; reason: string }[],
  grantFails: false,
  spendThrows: {} as Record<string, unknown>,
  commitFlagUpdateThrows: null as null | string,
  covered: false,
  inserts: [] as { data: unknown; error: unknown; throws?: boolean }[],
  events: [] as { outcome: string; reason: string }[],
  eventWriteThrows: false,
  order: [] as string[],
  requests: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "route-user" } } }) },
    from: () => {
      const readChain: Record<string, unknown> = new Proxy({}, { get: (_t, p) => (p === "maybeSingle" ? async () => ({ data: { structured_content: {} }, error: null }) : () => readChain) });
      return {
        select: () => readChain,
        insert: () => ({
          select: () => ({
            single: async () => {
              const next = world.inserts.shift() ?? { data: { id: "row-x" }, error: null };
              world.order.push("insert");
              if (next.throws) throw new Error("connection dropped");
              return next;
            },
          }),
        }),
      };
    },
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "job_tailoring_requests") return { insert: async (row: unknown) => (world.requests.push(row), { error: null }) };
      const filters: Array<[string, unknown]> = [];
      let patch: Record<string, unknown> | null = null;
      let returning = false;
      const matches = () => filters.every(([col, val]) => world.profile[col] === val);
      const run = async () => {
        await Promise.resolve();
        if (patch) {
          const flagSetTrue = Object.entries(patch).find(([, v]) => v === true)?.[0];
          if (world.commitFlagUpdateThrows && flagSetTrue === world.commitFlagUpdateThrows && filters.length === 1) throw new Error("profile write failed");
          if (!matches()) return { data: [], error: null };
          Object.assign(world.profile, patch);
          return { data: returning ? [{ id: world.profile.id }] : null, error: null };
        }
        return { data: matches() ? { ...world.profile } : null, error: null };
      };
      const chain: Record<string, unknown> = {
        select: () => ((returning = true), chain),
        update: (p: Record<string, unknown>) => ((patch = p), chain),
        eq: (col: string, val: unknown) => (filters.push([col, val]), chain),
        single: run,
        maybeSingle: run,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
      };
      return chain;
    },
  }),
}));

vi.mock("@/lib/credits/spend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/credits/spend")>();
  return {
    ...actual,
    spendCredits: async (_u: string, amount: number, reason: string) => {
      if (world.spendThrows[reason]) throw world.spendThrows[reason];
      if ((world.profile.credits_balance as number) < amount) throw new actual.InsufficientCreditsError(amount, world.profile.credits_balance as number);
      world.profile.credits_balance = (world.profile.credits_balance as number) - amount;
      world.ledger.push({ delta: -amount, reason });
      return world.profile.credits_balance as number;
    },
    grantCredits: async (_u: string, amount: number, reason: string) => {
      if (world.grantFails) throw new Error("Couldn't grant credits: ledger_down zz_marker_7731");
      world.profile.credits_balance = (world.profile.credits_balance as number) + amount;
      world.ledger.push({ delta: amount, reason });
      return world.profile.credits_balance as number;
    },
  };
});
vi.mock("@/lib/credits/gate-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credits/gate-events")>()),
  logCreditGateEvent: async (p: { outcome: string; reason: string }) => {
    if (world.eventWriteThrows && p.outcome === "covered_by_pass") throw new Error("event write failed");
    world.events.push({ outcome: p.outcome, reason: p.reason });
    if (p.outcome === "covered_by_pass") world.order.push("covered_by_pass");
  },
}));
vi.mock("@/lib/passes/entitlement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/passes/entitlement")>()),
  checkPassCoverage: async () => (world.covered ? { covered: true } : { covered: false, reason: "no_pass" }),
}));
vi.mock("@/lib/analytics/posthog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/analytics/posthog")>()), captureEvent: vi.fn() }));
vi.mock("@/lib/api/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/rate-limit")>()),
  consumeRateLimit: async () => ({ allowed: true, used: 1, resetsAt: null }),
}));
const GOOD = { tailoredResume: {}, coverLetter: "A cover letter.", gapAnalysis: {}, structuredJd: { title: "Backend Engineer" }, proposedAdditions: [] };
vi.mock("@/lib/tailoring/tailor", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/tailoring/tailor")>()), tailorResumeToJob: async () => GOOD }));
vi.mock("@/lib/courses/recommend", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/courses/recommend")>()), recommendCoursesForGapAnalysis: async () => [] }));

const { POST } = await import("@/app/api/tailoring/route");
const { InsufficientCreditsError } = await import("@/lib/credits/spend");

const JD = "We are hiring a backend engineer to build and operate payment APIs at scale. ".repeat(2);
const TAILOR = CREDIT_COSTS.tailoringRun;
const LETTER = CREDIT_COSTS.coverLetterRun;
const post = (includeCoverLetter: boolean) =>
  POST(new Request("http://localhost/api/tailoring", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jdText: JD, includeCoverLetter }) }));
const body = async (res: Response) => (await res.json()) as Record<string, unknown>;
const grants = () => world.ledger.filter((r) => r.delta > 0);
const spends = () => world.ledger.filter((r) => r.delta < 0);
const sum = () => world.ledger.reduce((s, r) => s + r.delta, 0);
const SAVE_FAILS = { data: null, error: { message: "db text" } };
const OK = (id: string) => ({ data: { id }, error: null });
let errorLog: ReturnType<typeof vi.spyOn>;
const logged = () => errorLog.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).join("\n");

/** Both trials used, a healthy balance: every leg is a paid leg unless a test changes that. */
const paidWorld = (balance = 100) => {
  world.profile = { id: "route-user", free_trial_tailoring_used: true, free_trial_cover_letter_used: true, credits_balance: balance };
};

beforeEach(() => {
  paidWorld();
  world.ledger = [];
  world.grantFails = false;
  world.spendThrows = {};
  world.commitFlagUpdateThrows = null;
  world.covered = false;
  world.inserts = [];
  world.events = [];
  world.eventWriteThrows = false;
  world.order = [];
  world.requests = [];
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("a paid run whose save fails gives the credits back", () => {
  it("1. the tailored-resume insert fails after two paid legs: two grants (tailoring, then letter), a 500 that says the credits were returned, the balance is whole again", async () => {
    world.inserts = [SAVE_FAILS];
    const res = await post(true);
    expect(res.status).toBe(500);
    expect(String((await body(res)).error)).toMatch(/returned/i);
    expect(grants()).toEqual([
      { delta: TAILOR, reason: "tailoring_run" },
      { delta: LETTER, reason: "cover_letter_run" },
    ]);
    expect(world.profile.credits_balance).toBe(100);
    expect(TAILOR).toBe(20);
    expect(LETTER).toBe(10);
  });
  it("2. the letter leg's commit throws a plain Error: the tailoring credits are granted back and the answer is a handled error, not an unhandled throw", async () => {
    world.spendThrows.cover_letter_run = new Error("Couldn't spend credits: ledger_check zz_marker_7731");
    const res = await post(true);
    expect(res.status).toBe(500);
    const json = await body(res);
    expect(String(json.error)).not.toContain("zz_marker_7731");
    expect(grants()).toEqual([{ delta: TAILOR, reason: "tailoring_run" }]);
    expect(world.profile.credits_balance).toBe(100);
  });
  it("2b. the same with a FREE-TRIAL letter leg: the letter's claim is released (flag false) and the tailoring is granted back", async () => {
    world.profile.free_trial_cover_letter_used = false;
    world.commitFlagUpdateThrows = "free_trial_cover_letter_used";
    const res = await post(true);
    expect(res.status).toBe(500);
    expect(world.profile.free_trial_cover_letter_used).toBe(false);
    expect(grants()).toEqual([{ delta: TAILOR, reason: "tailoring_run" }]);
  });
  it("3. the letter row insert fails: the letter's credits are granted back, the tailored resume is still delivered, and creditsSpent excludes the letter", async () => {
    world.inserts = [OK("resume-1"), SAVE_FAILS];
    const res = await post(true);
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(json.resumeId).toBe("resume-1");
    expect(json.coverLetterResumeId).toBeNull();
    expect(json.creditsSpent).toBe(TAILOR);
    expect(String(json.notice)).toMatch(/returned/i);
    expect(grants()).toEqual([{ delta: LETTER, reason: "cover_letter_run" }]);
    expect(json.creditsBalance).toBe(100 - TAILOR);
  });
});

describe("a grant that fails", () => {
  it("4. is logged with the user, the reason, the credits and a time; the response does not say credits were returned and points to support with that time", async () => {
    world.grantFails = true;
    world.inserts = [SAVE_FAILS];
    const res = await post(false);
    expect(res.status).toBe(500);
    const error = String((await body(res)).error);
    expect(error).not.toMatch(/returned/i);
    expect(error).not.toContain("zz_marker_7731");
    expect(error).toMatch(/support/i);
    expect(error).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    const log = logged();
    expect(log).toContain("route-user");
    expect(log).toContain("tailoring_run");
    expect(log).toMatch(/credits=20/);
    expect(log).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(log).toContain("zz_marker_7731");
  });
});

describe("a free-trial leg whose save fails is not used up", () => {
  it("5. tailoring on the trial: the flag is set back, nothing is granted, and an immediate retry is free again", async () => {
    world.profile.free_trial_tailoring_used = false;
    world.inserts = [SAVE_FAILS];
    const res = await post(false);
    expect(res.status).toBe(500);
    expect(String((await body(res)).error)).toMatch(/free try was not used/i);
    expect(world.profile.free_trial_tailoring_used).toBe(false);
    expect(grants()).toEqual([]);
    const retry = await post(false);
    expect(retry.status).toBe(200);
    const json = await body(retry);
    expect(json.isFreeTrial).toBe(true);
    expect(spends()).toEqual([]);
    expect(world.profile.free_trial_tailoring_used).toBe(true);
  });
  it("6. the letter on the trial (tailoring paid): the cover-letter flag is released, the paid leg is granted back, and a retry takes the free letter again", async () => {
    world.profile.free_trial_cover_letter_used = false;
    world.inserts = [SAVE_FAILS];
    const res = await post(true);
    expect(res.status).toBe(500);
    expect(world.profile.free_trial_cover_letter_used).toBe(false);
    expect(grants()).toEqual([{ delta: TAILOR, reason: "tailoring_run" }]);
    const retry = await post(true);
    expect(retry.status).toBe(200);
    const json = await body(retry);
    expect(json.creditsSpent).toBe(TAILOR);
    expect(spends().filter((r) => r.reason === "cover_letter_run")).toEqual([]);
    expect(world.profile.free_trial_cover_letter_used).toBe(true);
  });
  it("9. mixed legs (tailoring paid, letter on the trial) and a failed save: one grant (the tailoring) and one release (the letter)", async () => {
    world.profile.free_trial_cover_letter_used = false;
    world.inserts = [SAVE_FAILS];
    await post(true);
    expect(grants()).toEqual([{ delta: TAILOR, reason: "tailoring_run" }]);
    expect(world.profile.free_trial_cover_letter_used).toBe(false);
  });
});

describe("a Pass-covered run", () => {
  it("7. a failed save writes no covered_by_pass event: the cap count is what it was before the request", async () => {
    world.covered = true;
    world.inserts = [SAVE_FAILS];
    const before = world.events.filter((e) => e.outcome === "covered_by_pass").length;
    const res = await post(true);
    expect(res.status).toBe(500);
    expect(world.events.filter((e) => e.outcome === "covered_by_pass").length).toBe(before);
    expect(grants()).toEqual([]);
  });
  it("8. the happy path writes exactly one covered_by_pass event per covered leg, each AFTER the save", async () => {
    world.covered = true;
    const res = await post(true);
    expect(res.status).toBe(200);
    const pass = world.events.filter((e) => e.outcome === "covered_by_pass");
    expect(pass.map((e) => e.reason).sort()).toEqual(["cover_letter_run", "tailoring_run"]);
    // order: resume insert, event (tailoring), letter insert, event (letter)
    expect(world.order).toEqual(["insert", "covered_by_pass", "insert", "covered_by_pass"]);
  });
  it("12. an event write that fails after a successful save is logged and the run still answers 200 with the resume", async () => {
    world.covered = true;
    world.eventWriteThrows = true;
    const res = await post(false);
    expect(res.status).toBe(200);
    expect((await body(res)).resumeId).toBe("row-x");
    expect(logged()).toMatch(/covered_by_pass/);
  });
});

describe("what does not change", () => {
  it("10. a paid happy run grants nothing; a short balance at the letter leg still delivers the tailoring without the letter", async () => {
    const ok = await post(true);
    expect(ok.status).toBe(200);
    expect(grants()).toEqual([]);
    expect(spends()).toEqual([
      { delta: -TAILOR, reason: "tailoring_run" },
      { delta: -LETTER, reason: "cover_letter_run" },
    ]);
    // the letter's spend finds the credits gone (another request took them between the check and the commit)
    paidWorld(100);
    world.ledger = [];
    world.spendThrows.cover_letter_run = new InsufficientCreditsError(LETTER, 0);
    const short = await post(true);
    expect(short.status).toBe(200);
    const json = await body(short);
    expect(json.coverLetterResumeId).toBeNull();
    expect(json.creditsSpent).toBe(TAILOR);
    expect(grants()).toEqual([]);
  });
});

describe("a leg is returned once", () => {
  it("11a. the drain run twice grants each leg once (the grant has no idempotency key)", async () => {
    const { TailoringCommitLedger, refundTailoringCommits } = await import("@/lib/tailoring/commit-ledger");
    const ledger = new TailoringCommitLedger();
    ledger.record({ kind: "tailoring", reason: "tailoring_run", mode: "paid", credits: TAILOR, creditsAvailableAtCheck: 100 });
    ledger.record({ kind: "cover_letter", reason: "cover_letter_run", mode: "paid", credits: LETTER, creditsAvailableAtCheck: 100 });
    await refundTailoringCommits("route-user", ledger);
    await refundTailoringCommits("route-user", ledger);
    expect(grants()).toEqual([
      { delta: TAILOR, reason: "tailoring_run" },
      { delta: LETTER, reason: "cover_letter_run" },
    ]);
  });
  it("11b. a save that throws (not an error row) after the commits: the outer handler refunds once", async () => {
    world.inserts = [{ data: null, error: null, throws: true }];
    const res = await post(true);
    expect(res.status).toBe(500);
    expect(grants()).toEqual([
      { delta: TAILOR, reason: "tailoring_run" },
      { delta: LETTER, reason: "cover_letter_run" },
    ]);
  });
});

describe("13. a retry after a refunded failure nets one charge", () => {
  it("the ledger sums to exactly one run's cost", async () => {
    world.inserts = [SAVE_FAILS];
    expect((await post(false)).status).toBe(500);
    expect(sum()).toBe(0);
    expect((await post(false)).status).toBe(200);
    expect(sum()).toBe(-TAILOR);
    expect(world.profile.credits_balance).toBe(100 - TAILOR);
  });
});
