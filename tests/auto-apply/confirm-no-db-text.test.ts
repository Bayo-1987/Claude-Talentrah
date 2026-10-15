/**
 * RAW-DB-TEXT-1, step 1: confirmAutoApplyAction (the action that claims credits) never hands the database's own error text to the person. The text goes to the server log with the ids; the person gets a plain
 * sentence that keeps the opening phrase. The claim itself is untouched: it still runs exactly once, and a failed claim leaves nothing claimed and nothing released. Supabase and the credit helpers are faked;
 * the action is the real one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpcCalls: [] as unknown[],
  rpcResult: { data: null, error: null } as { data: unknown; error: null | { message: string } },
  tableCalls: [] as { table: string; op: string }[],
  spend: vi.fn(),
  covered: false,
}));

function chain(table: string, result: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = new Proxy({}, {
    get: (_t, p) => {
      if (p === "then") return (res: (v: unknown) => unknown) => res(result());
      if (p === "maybeSingle" || p === "single") return async () => result();
      return (...args: unknown[]) => {
        if (p === "update" || p === "upsert" || p === "insert" || p === "delete") h.tableCalls.push({ table, op: String(p) });
        void args;
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
    rpc: async (name: string, args: unknown) => {
      h.rpcCalls.push({ name, args });
      return h.rpcResult;
    },
    from: (table: string) => chain(table, () => ({ data: { external_url: "https://example.com/job/1" }, error: null })),
  }),
}));
vi.mock("@/lib/credits/spend", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/credits/spend")>()), spendCredits: (...a: unknown[]) => h.spend(...a) }));
vi.mock("@/lib/credits/gate-events", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/credits/gate-events")>()), logCreditGateEvent: vi.fn() }));
vi.mock("@/lib/passes/entitlement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/passes/entitlement")>()),
  checkPassCoverage: async () => ({ covered: h.covered, reason: "no_active_pass" }),
}));
vi.mock("@/lib/applications/job-snapshot", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/applications/job-snapshot")>()), loadJobSnapshot: async () => null }));
vi.mock("@/lib/analytics/posthog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/analytics/posthog")>()), captureEvent: vi.fn() }));

import { confirmAutoApplyAction } from "@/lib/auto-apply/actions";
import { AUTO_APPLY_DAILY_SUBMIT_CAP, AUTO_APPLY_FREE_PER_WEEK, AUTO_APPLY_MIN_SCORE } from "@/lib/auto-apply/config";
import { CREDIT_COSTS } from "@/lib/credits/costs";

const MARKER = 'auto_apply_queue_status_check violates check constraint "zz_marker_9137"';
const QUEUE_ID = "queue-77";
/** The claim's seven arguments, in full: the constants are imported, never hardcoded, so a changed gate value is caught here. */
const claimArgs = (hasActivePass: boolean) => ({
  p_user_id: "user-1",
  p_queue_id: QUEUE_ID,
  p_min_score: AUTO_APPLY_MIN_SCORE,
  p_daily_cap: AUTO_APPLY_DAILY_SUBMIT_CAP,
  p_free_per_week: AUTO_APPLY_FREE_PER_WEEK,
  p_credit_cost: CREDIT_COSTS.autoApplySubmission,
  p_has_active_pass: hasActivePass,
});
let errorLog: ReturnType<typeof vi.spyOn>;
const logged = () => errorLog.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).join("\n");

beforeEach(() => {
  h.rpcCalls = [];
  h.rpcResult = { data: null, error: null };
  h.tableCalls = [];
  h.covered = false;
  h.spend.mockReset();
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the claim call fails with a database error", () => {
  beforeEach(() => {
    h.rpcResult = { data: null, error: { message: MARKER } };
  });
  it("(a) returns a plain sentence that keeps the opening phrase and none of the database text", async () => {
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(out.ok).toBe(false);
    const error = !out.ok ? out.error : "";
    expect(error).toMatch(/^Couldn't confirm\./);
    expect(error).not.toContain("zz_marker_9137");
    expect(error).not.toContain("constraint");
    expect(error).not.toContain("auto_apply_queue");
  });
  it("(b) logs the database message with the user id and the queue id", async () => {
    await confirmAutoApplyAction(QUEUE_ID);
    expect(logged()).toContain("zz_marker_9137");
    expect(logged()).toContain("user-1");
    expect(logged()).toContain(QUEUE_ID);
  });
  it("(c) a failed claim leaves nothing claimed and nothing released: one claim call, no spend, no table write", async () => {
    await confirmAutoApplyAction(QUEUE_ID);
    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0]).toEqual({ name: "auto_apply_claim_submission", args: claimArgs(false) });
    expect(h.spend).not.toHaveBeenCalled();
    expect(h.tableCalls).toEqual([]);
  });
  it("(c) makes the same claim call whether or not a pass covers the user (the coverage flag is passed through)", async () => {
    h.covered = true;
    await confirmAutoApplyAction(QUEUE_ID);
    expect(h.rpcCalls).toEqual([{ name: "auto_apply_claim_submission", args: claimArgs(true) }]);
  });
});

describe("(c) a claim that succeeds", () => {
  it("runs the claim exactly once, with the queue id, and releases nothing", async () => {
    h.rpcResult = { data: [{ ok: true, reason: "handed_off", job_posting_id: "job-1", pass_covered: false, charge: 0 }], error: null };
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(out).toEqual({ ok: true, outcome: "handed_off", externalUrl: "https://example.com/job/1" });
    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0]).toEqual({ name: "auto_apply_claim_submission", args: claimArgs(false) });
    expect(h.tableCalls.filter((c) => c.table === "auto_apply_queue")).toEqual([]);
    expect(h.spend).not.toHaveBeenCalled();
  });
});
