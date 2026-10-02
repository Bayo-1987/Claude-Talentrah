/**
 * send-502 — the operator's last step in the refund runbook: after refunding the charge in Paystack, mark the session
 * refunded so it leaves the "Mentor payments to refund" list and the nav badge.
 *
 * The write is conditional on the session still being payment_needs_refund (check and act in one statement, the repo's rule),
 * needs the `operations` permission, and is attributed in the admin audit trail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ops: [] as Array<[string, unknown[]]>,
  updated: [{ id: "s1" }] as unknown[],
  error: null as null | { message: string },
  perm: vi.fn(async () => ({ adminId: "a1", email: "admin@example.test", sessionId: "sess" })),
  audit: vi.fn<(input: unknown) => Promise<void>>(async () => {}),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/admin/require-admin", () => ({ requirePermission: h.perm }));
vi.mock("@/lib/admin/audit", () => ({ recordAdminAction: h.audit }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidate }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      h.ops.push(["from", [table]]);
      const chain: Record<string, unknown> = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data: h.updated, error: h.error });
            return (...args: unknown[]) => {
              h.ops.push([String(prop), args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
  }),
}));

import { markMentorPaymentRefundedAction } from "@/lib/admin/ops/refund-actions";

beforeEach(() => {
  h.ops.length = 0;
  h.updated = [{ id: "s1" }];
  h.error = null;
  h.perm.mockClear();
  h.audit.mockClear();
  h.revalidate.mockClear();
});

describe("markMentorPaymentRefundedAction", () => {
  it("requires the operations permission", async () => {
    await markMentorPaymentRefundedAction("s1");
    expect(h.perm).toHaveBeenCalledWith("operations");
  });

  it("moves payment_needs_refund to refunded, and only from payment_needs_refund", async () => {
    await markMentorPaymentRefundedAction("s1");
    expect(h.ops).toContainEqual(["from", ["mentorship_sessions"]]);
    expect(h.ops.find(([n]) => n === "update")?.[1][0]).toMatchObject({ status: "refunded" });
    expect(h.ops).toContainEqual(["eq", ["id", "s1"]]);
    expect(h.ops).toContainEqual(["eq", ["status", "payment_needs_refund"]]);
  });

  it("records who did it", async () => {
    await markMentorPaymentRefundedAction("s1");
    expect(h.audit).toHaveBeenCalledTimes(1);
    expect(h.audit.mock.calls[0][0]).toMatchObject({ action: "ops.mentor_payment_marked_refunded", targetTable: "mentorship_sessions", targetId: "s1" });
  });

  it("a rejected update is reported, not swallowed (a Supabase error resolves, it does not throw)", async () => {
    h.error = { message: "permission denied" };
    await expect(markMentorPaymentRefundedAction("s1")).rejects.toThrow(/could not mark/i);
    expect(h.audit).not.toHaveBeenCalled();
  });

  it("a session that was not in payment_needs_refund changes nothing and is not audited as a change", async () => {
    h.updated = [];
    await markMentorPaymentRefundedAction("s1");
    expect(h.audit).not.toHaveBeenCalled();
  });
});
