/**
 * Who can see the mentor refund list and who can press Mark refunded. Both are behind the `operations` permission (not `finance`), checked by the REAL guard (requirePermission) against an operator
 * whose role holds other areas only. Behaviour, not source: the page must redirect before reading or rendering anything, and the action must refuse before it touches the database or the audit log.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const h = vi.hoisted(() => ({
  identity: null as null | { adminId: string; email: string; displayName: string; permissions: string[] },
  queryCalls: [] as string[],
  dbCalls: [] as string[],
  audit: vi.fn(async () => {}),
}));

class Redirect extends Error {
  constructor(public to: string) {
    super(`NEXT_REDIRECT ${to}`);
  }
}
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Redirect(to); } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/admin/session", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/admin/session")>()), getAdminIdentity: async () => h.identity }));
vi.mock("@/lib/admin/audit", () => ({ recordAdminAction: h.audit }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ from: (t: string) => { h.dbCalls.push(t); throw new Error("the database must not be touched"); } }) }));
vi.mock("@/lib/admin/ops/queries", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/admin/ops/queries")>();
  const track = <K extends keyof typeof real>(name: K) => (async () => { h.queryCalls.push(String(name)); return []; }) as unknown as (typeof real)[K];
  return {
    ...real,
    stuckRenewals: track("stuckRenewals"),
    autoApplyQueueHealth: (async () => { h.queryCalls.push("autoApplyQueueHealth"); return { byStatus: {}, stalePending: 0, oldestPendingAt: null }; }) as unknown as typeof real.autoApplyQueueHealth,
    rateLimitBuckets: track("rateLimitBuckets"),
    feedFreshness: track("feedFreshness"),
    operatorCredentialEvents: track("operatorCredentialEvents"),
    storageUsage: (async () => { h.queryCalls.push("storageUsage"); return { error: "not measured in this test" }; }) as unknown as typeof real.storageUsage,
    paymentsNeedingRefund: (async () => { h.queryCalls.push("paymentsNeedingRefund"); return [{ sessionId: "s-1", amountNgn: 5000, markedAt: "2026-10-01T10:00:00Z", sessionStart: "2026-10-02T10:00:00Z", reference: "ref_secret_ref" }]; }) as unknown as typeof real.paymentsNeedingRefund,
  };
});

const withoutOperations = { adminId: "a1", email: "finance@example.test", displayName: "Finance only", permissions: ["finance", "blog", "people"] };
const withOperations = { adminId: "a2", email: "ops@example.test", displayName: "Ops", permissions: ["operations"] };

beforeEach(() => {
  h.identity = null;
  h.queryCalls.length = 0;
  h.dbCalls.length = 0;
  h.audit.mockClear();
});

describe("the ops page and the refund list", () => {
  it("an operator WITHOUT the operations permission (even holding finance) is redirected to /admin before any query runs, and sees no refund list", async () => {
    h.identity = withoutOperations;
    const { default: OpsPage } = await import("@/app/admin/(protected)/ops/page");
    await expect(OpsPage()).rejects.toMatchObject({ to: "/admin" });
    expect(h.queryCalls, "no query ran for the refused operator").toEqual([]);
  });

  it("an operator WITH it is shown the list, the reference and the runbook", async () => {
    h.identity = withOperations;
    const { default: OpsPage } = await import("@/app/admin/(protected)/ops/page");
    const text = renderToStaticMarkup(await OpsPage()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(h.queryCalls).toContain("paymentsNeedingRefund");
    expect(text).toContain("ref_secret_ref");
    expect(text).toContain("Refund the charge in the Paystack dashboard");
  });
});

describe("Mark refunded", () => {
  const form = () => { const f = new FormData(); f.set("sessionId", "s-1"); return f; };

  it("refuses an operator WITHOUT the operations permission: redirected, nothing written, nothing audited", async () => {
    h.identity = withoutOperations;
    const { markMentorPaymentRefundedAction } = await import("@/lib/admin/ops/refund-actions");
    const { initialRefundActionState } = await import("@/lib/admin/ops/refund-state");
    await expect(markMentorPaymentRefundedAction(initialRefundActionState, form())).rejects.toMatchObject({ to: "/admin" });
    expect(h.dbCalls, "the database was never reached").toEqual([]);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller the same way (to the login page)", async () => {
    h.identity = null;
    const { markMentorPaymentRefundedAction } = await import("@/lib/admin/ops/refund-actions");
    const { initialRefundActionState } = await import("@/lib/admin/ops/refund-state");
    await expect(markMentorPaymentRefundedAction(initialRefundActionState, form())).rejects.toMatchObject({ to: expect.stringContaining("/admin/login") });
    expect(h.dbCalls).toEqual([]);
    expect(h.audit).not.toHaveBeenCalled();
  });
});
