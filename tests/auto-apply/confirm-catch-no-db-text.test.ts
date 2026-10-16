/**
 * RAW-DB-TEXT-1, step 2 (5b): the catch block of confirmAutoApplyAction. A thrown error reaches the person only when it is meant for them (not enough credits; the unedited example resume). Ledger and database text
 * (a spend failure, the applications upsert's error) goes to the server log with the ids, and the person reads "Couldn't submit. Please try again." The claim release in the catch is unchanged: one update of the queue
 * row back to pending, and nothing else written. Supabase and the credit helpers are faked; the action is the real one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  writes: [] as { table: string; op: string; payload: unknown }[],
  appError: null as null | { message: string },
  exampleResume: false,
  spend: vi.fn(),
  grant: vi.fn(),
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
    rpc: async () => ({ data: [{ ok: true, reason: "submitted", job_posting_id: "job-1", pass_covered: false, charge: 5 }], error: null }),
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
const RELEASE = { table: "auto_apply_queue", op: "update", payload: { status: "pending", decided_at: null, credits_spent: 0 } };
let errorLog: ReturnType<typeof vi.spyOn>;
const logged = () => errorLog.mock.calls.map((c: unknown[]) => c.map(String).join(" ")).join("\n");
const returned = (out: Awaited<ReturnType<typeof confirmAutoApplyAction>>) => (out.ok ? "" : out.error);

beforeEach(() => {
  h.writes = [];
  h.appError = null;
  h.exampleResume = false;
  h.spend.mockReset();
  h.grant.mockReset();
  h.grant.mockResolvedValue(undefined);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("database and ledger text never reaches the person", () => {
  it("(a) a spend failure with ledger text: plain sentence, marker and both ids in the log, claim released once", async () => {
    h.spend.mockRejectedValue(new Error('Couldn\'t spend credits: ledger_entries_check violates "zz_marker_4412"'));
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(returned(out)).toBe(PLAIN);
    expect(returned(out)).not.toContain("zz_marker_4412");
    expect(logged()).toContain("zz_marker_4412");
    expect(logged()).toContain("user-1");
    expect(logged()).toContain(QUEUE_ID);
    expect(h.writes).toEqual([RELEASE]);
  });
  it("(a2) a spend failure that merely shares the harmless-looking prefix is still plain (matched by type, not by text)", async () => {
    h.spend.mockRejectedValue(new Error("Couldn't spend credits: no response from the ledger."));
    expect(returned(await confirmAutoApplyAction(QUEUE_ID))).toBe(PLAIN);
  });
  it("(b) the applications upsert fails with database text: plain sentence, marker and both ids in the log, claim released once", async () => {
    h.appError = { message: 'duplicate key value violates unique constraint "zz_marker_4412"' };
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(returned(out)).toBe(PLAIN);
    expect(returned(out)).not.toContain("zz_marker_4412");
    expect(logged()).toContain("zz_marker_4412");
    expect(logged()).toContain("user-1");
    expect(logged()).toContain(QUEUE_ID);
    expect(h.writes.map((w) => `${w.table}.${w.op}`)).toEqual(["applications.upsert", "auto_apply_queue.update"]);
    expect(h.writes[1]).toEqual(RELEASE);
    // AUTO-APPLY-REFUND-1, deliberate: the spend had already completed (this test's spend mock resolves, and the claim's charge is 5), so the failure path now also gives that charge back. Before, "no other write"
    // here described a failure path that kept the person's credit; the table writes are unchanged, and the refund goes through the ledger helper.
    expect(h.grant).toHaveBeenCalledTimes(1);
    expect(h.grant).toHaveBeenCalledWith("user-1", 5, "auto_apply_run", QUEUE_ID);
  });
});

describe("text meant for the person still reaches them, unchanged", () => {
  it("(c) not enough credits keeps its wording", async () => {
    h.spend.mockRejectedValue(new InsufficientCreditsError(5, 2));
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(returned(out)).toBe("Couldn't submit: Needs 5 credits, only 2 available.");
    expect(h.writes).toEqual([RELEASE]);
  });
  it("(d) the unedited example resume keeps its sentence", async () => {
    h.exampleResume = true;
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(returned(out)).toBe("Couldn't submit: your resume still has unedited example content — update it in the Resume Builder first");
    expect(h.writes).toEqual([RELEASE]);
    // AUTO-APPLY-REFUND-1, deliberate: the spend completed before the example-resume check threw, so the charge is given back (once, with the queue id).
    expect(h.grant).toHaveBeenCalledTimes(1);
    expect(h.grant).toHaveBeenCalledWith("user-1", 5, "auto_apply_run", QUEUE_ID);
  });
});

describe("the claim release is unchanged", () => {
  it("(e) in every failure above: exactly one update of the queue row to pending, decided_at null, credits_spent 0, and no other write", async () => {
    const cases: (() => void)[] = [
      () => h.spend.mockRejectedValue(new Error("ledger text")),
      () => { h.spend.mockResolvedValue(undefined); h.appError = { message: "db text" }; },
      () => h.spend.mockRejectedValue(new InsufficientCreditsError(5, 2)),
      () => { h.spend.mockResolvedValue(undefined); h.exampleResume = true; },
    ];
    // AUTO-APPLY-REFUND-1, deliberate: the refund is part of the failure path where the spend completed (cases 2 and 4: the upsert fails, the example resume throws) and absent where it did not (cases 1 and 3: the
    // spend itself failed). The table writes asserted below are unchanged: the refund is a ledger call, not a table write.
    const refundExpected = [false, true, false, true];
    for (const [i, arrange] of cases.entries()) {
      h.grant.mockClear();
      h.writes = [];
      h.appError = null;
      h.exampleResume = false;
      arrange();
      await confirmAutoApplyAction(QUEUE_ID);
      const queueWrites = h.writes.filter((w) => w.table === "auto_apply_queue");
      expect(queueWrites).toEqual([RELEASE]);
      expect(h.writes.filter((w) => w.table !== "auto_apply_queue" && w.table !== "applications")).toEqual([]);
      expect(h.grant).toHaveBeenCalledTimes(refundExpected[i] ? 1 : 0);
    }
  });
});

describe("(f) a thrown value that is not an Error", () => {
  it("still returns \"Couldn't submit.\" and releases the claim", async () => {
    h.spend.mockRejectedValue("a bare string");
    const out = await confirmAutoApplyAction(QUEUE_ID);
    expect(returned(out)).toBe("Couldn't submit.");
    expect(h.writes).toEqual([RELEASE]);
  });
});
