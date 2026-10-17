/**
 * AUTO-APPLY-REFUND-1: confirmAutoApplyAction debits first (spend_credits_atomic has no idempotency key and writes a ledger row every time). If anything AFTER a completed spend throws (the unedited example resume,
 * the applications upsert), the claim is released but the credit used to stay spent, and a retry spent again. The charge is now given back once, only when the spend itself completed and only when it was a real
 * charge. A refund that fails never changes what the person is told. Supabase and the credit helpers are faked; the action is the real one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  writes: [] as { table: string; op: string; payload: unknown }[],
  appError: null as null | { message: string },
  exampleResume: false,
  charge: 5,
  spend: vi.fn(),
  grant: vi.fn(),
  ledger: { balance: 0 },
}));

function chain(table: string, result: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) => {
      if (p === "then") return (res: (v: unknown) => unknown) => res(result());
      if (p === "maybeSingle" || p === "single") return async () => result();
      return (...args: unknown[]) => {
        if (p === "update" || p === "upsert" || p === "insert" || p === "delete") h.writes.push({ table, op: String(p), payload: args[0] });
        return c;
      };
    },
  });
  return c;
}

vi.mock("next/cache", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/cache")>()), revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => ({
    rpc: async () => ({ data: [{ ok: true, reason: "submitted", job_posting_id: "job-1", pass_covered: false, charge: h.charge }], error: null }),
    from: (table: string) =>
      chain(table, () => {
        if (table === "resumes") return { data: { id: "resume-1", structured_content: h.exampleResume ? { example: true } : null }, error: null };
        if (table === "applications") return { data: { id: "app-1" }, error: h.appError };
        return { data: null, error: null };
      }),
  }),
}));
vi.mock("@/lib/credits/spend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/credits/spend")>()),
  spendCredits: (...a: unknown[]) => h.spend(...a),
  grantCredits: (...a: unknown[]) => h.grant(...a),
}));
vi.mock("@/lib/credits/gate-events", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/credits/gate-events")>()), logCreditGateEvent: vi.fn() }));
vi.mock("@/lib/passes/entitlement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/passes/entitlement")>()),
  checkPassCoverage: async () => ({ covered: false, reason: "no_active_pass" }),
}));
vi.mock("@/lib/resume-builder/example-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/resume-builder/example-guard")>()),
  hasUneditedExampleContent: () => h.exampleResume,
}));
vi.mock("@/lib/applications/job-snapshot", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/applications/job-snapshot")>()), loadJobSnapshot: async () => null }));
vi.mock("@/lib/analytics/posthog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/analytics/posthog")>()), captureEvent: vi.fn() }));

import { confirmAutoApplyAction } from "@/lib/auto-apply/actions";
import { InsufficientCreditsError } from "@/lib/credits/spend";

const QUEUE_ID = "queue-77";
const PLAIN = "Couldn't submit. Please try again.";
const EXAMPLE = "Couldn't submit: your resume still has unedited example content — update it in the Resume Builder first";
const RELEASE = { table: "auto_apply_queue", op: "update", payload: { status: "pending", decided_at: null, credits_spent: 0 } };
let errorLog: ReturnType<typeof vi.spyOn>;
const logged = () => errorLog.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).join("\n");
const returned = (out: Awaited<ReturnType<typeof confirmAutoApplyAction>>) => (out.ok ? "" : out.error);
const releases = () => h.writes.filter((w) => w.table === "auto_apply_queue" && JSON.stringify(w.payload) === JSON.stringify(RELEASE.payload));

beforeEach(() => {
  h.writes = [];
  h.appError = null;
  h.exampleResume = false;
  h.charge = 5;
  h.spend.mockReset();
  h.spend.mockResolvedValue(undefined);
  h.grant.mockReset();
  h.grant.mockResolvedValue(undefined);
  h.ledger.balance = 20;
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a charge that was taken is given back when the submit then fails", () => {
  it("(a) the applications upsert fails: refunded once with (user, charge, reason, queue id); message unchanged; claim released once", async () => {
    h.appError = { message: "db text" };
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(h.grant).toHaveBeenCalledTimes(1);
    expect(h.grant).toHaveBeenCalledWith("user-1", 5, "auto_apply_run", QUEUE_ID);
    expect(returned(out)).toBe(PLAIN);
    expect(releases()).toHaveLength(1);
  });
  it("(b) the unedited example resume: the same refund, once", async () => {
    h.exampleResume = true;
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(h.grant).toHaveBeenCalledTimes(1);
    expect(h.grant).toHaveBeenCalledWith("user-1", 5, "auto_apply_run", QUEUE_ID);
    expect(returned(out)).toBe(EXAMPLE);
    expect(releases()).toHaveLength(1);
  });
});

describe("no refund where nothing was taken", () => {
  it("(c) spend throws InsufficientCreditsError: no refund, message unchanged", async () => {
    h.spend.mockRejectedValue(new InsufficientCreditsError(5, 2));
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(h.grant).not.toHaveBeenCalled();
    expect(returned(out)).toBe("Couldn't submit: Needs 5 credits, only 2 available.");
  });
  it("(d) spend throws a plain Error with ledger text: no refund, plain sentence", async () => {
    h.spend.mockRejectedValue(new Error("Couldn't spend credits: ledger text"));
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(h.grant).not.toHaveBeenCalled();
    expect(returned(out)).toBe(PLAIN);
  });
  it("(e) a zero charge (free allowance, a pass) and a later failure: no spend, no refund", async () => {
    h.charge = 0;
    h.appError = { message: "db text" };
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(h.spend).not.toHaveBeenCalled();
    expect(h.grant).not.toHaveBeenCalled();
    expect(returned(out)).toBe(PLAIN);
  });
  it("(g) the success path: no refund and no extra ledger call", async () => {
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(out).toEqual({ ok: true, outcome: "submitted" });
    expect(h.spend).toHaveBeenCalledTimes(1);
    expect(h.grant).not.toHaveBeenCalled();
    expect(releases()).toHaveLength(0);
  });
});

describe("(f) a refund that fails never changes the outcome", () => {
  it("returns the original message, logs the failure with the user id, the queue id and the charge, throws nothing, and the claim is still released (option A)", async () => {
    h.appError = { message: "db text" };
    h.grant.mockRejectedValue(new Error("Couldn't grant credits: ledger_down zz_marker_5521"));
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(returned(out)).toBe(PLAIN);
    expect(returned(out)).not.toContain("zz_marker_5521");
    expect(logged()).toContain("REFUND FAILED");
    expect(logged()).toContain("user-1");
    expect(logged()).toContain(QUEUE_ID);
    expect(logged()).toMatch(/charge=5/);
    expect(logged()).toContain("zz_marker_5521");
    // Pinned as built: the row is reset to pending even though the refund failed, so a retry would claim and spend again. That hazard is why the log line is loud; whether to leave the row claimed instead is an open decision.
    expect(releases()).toHaveLength(1);
  });
  it("the same holds for the other post-spend failure (the unedited example resume): the user text is unchanged and the claim is released", async () => {
    h.exampleResume = true;
    h.grant.mockRejectedValue(new Error("ledger_down"));
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(returned(out)).toBe(EXAMPLE);
    expect(releases()).toHaveLength(1);
  });
});

describe("(h) net effect on a ledger that applies the spend and the grant", () => {
  it("a failed submit followed by a second confirm that succeeds charges the person exactly once", async () => {
    h.spend.mockImplementation(async (_u: string, amount: number) => { h.ledger.balance -= amount; });
    h.grant.mockImplementation(async (_u: string, amount: number) => { h.ledger.balance += amount; });
    h.appError = { message: "db text" };
    await confirmAutoApplyAction(QUEUE_ID);
    expect(h.ledger.balance).toBe(20); // the failed attempt cost nothing
    h.appError = null;
    const second = await confirmAutoApplyAction(QUEUE_ID);
    expect(second).toEqual({ ok: true, outcome: "submitted" });
    expect(h.ledger.balance).toBe(15); // charged once, for the one submission
  });
});
