/**
 * send-502 / S15 — "never silently keep the money", seen from the operator's side.
 *
 * A payment that lands on a booking that already lapsed and cannot be reinstated leaves the session in `payment_needs_refund`.
 * That is a charge that will not fix itself, so it is exactly what the admin ops nav badge counts (opsAttentionCount: "things
 * that will not fix themselves"), and the ops page lists it. Unit-level, with a fake service client: what the query asks for
 * and that the badge moves by exactly the number of such sessions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ refundRows: [] as Array<Record<string, unknown>>, sessionQueries: [] as Array<Array<[string, unknown[]]>> }));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      const ops: Array<[string, unknown[]]> = [];
      if (table === "mentorship_sessions") state.sessionQueries.push(ops);
      const result = () => ({ data: table === "mentorship_sessions" ? state.refundRows : [], error: null, count: 0 });
      const chain: Record<string, unknown> = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result());
            return (...args: unknown[]) => {
              ops.push([String(prop), args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
    schema: () => ({ from: () => ({ select: async () => ({ data: [], error: null }) }) }),
    rpc: async () => ({ data: [], error: null }),
  }),
}));

import * as ops from "@/lib/admin/ops/queries";

const row = (n: number) => ({ id: `s${n}`, price_ngn: 25_000, updated_at: "2026-10-01T10:00:00.000Z", scheduled_start: "2026-09-17T10:00:00.000Z" });

beforeEach(() => {
  state.refundRows = [];
  state.sessionQueries.length = 0;
});

describe("paymentsNeedingRefund", () => {
  it("is exported, and asks for sessions in status payment_needs_refund", async () => {
    const fn = (ops as Record<string, unknown>).paymentsNeedingRefund as (() => Promise<unknown[]>) | undefined;
    expect(fn, "paymentsNeedingRefund must be exported from src/lib/admin/ops/queries.ts").toBeTypeOf("function");
    state.refundRows = [row(1), row(2)];
    const out = await fn!();
    expect(out).toHaveLength(2);
    const ops0 = state.sessionQueries[0];
    expect(ops0).toContainEqual(["eq", ["status", "payment_needs_refund"]]);
  });

  it("returns nothing when there is nothing to refund", async () => {
    const fn = (ops as Record<string, unknown>).paymentsNeedingRefund as (() => Promise<unknown[]>) | undefined;
    expect(fn).toBeTypeOf("function");
    expect(await fn!()).toEqual([]);
  });
});

describe("the ops attention badge counts them", () => {
  it("moves by exactly the number of sessions needing a refund", async () => {
    const baseline = await ops.opsAttentionCount();
    state.refundRows = [row(1), row(2), row(3)];
    const withRefunds = await ops.opsAttentionCount();
    expect(withRefunds - baseline).toBe(3);
  });
});

describe("the ops page tells the operator what to do (send-502 runbook)", () => {
  // A BEHAVIOUR test: render what the operator is shown for a row that needs a refund and read the text, instead of reading source files (the runbook moved into the list component
  // in REFUND-SILENT-1, and a source-reading test broke on the move without anything having changed for the operator).
  it("shows the runbook with a row: where to find the reference, how to refund, how to mark it resolved", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { MentorRefundList } = await import("@/components/admin/mentor-refund-list");
    const html = renderToStaticMarkup(
      createElement(MentorRefundList, {
        rows: [{ sessionId: "s-1", amountNgn: 5000, markedAt: "2026-10-01T10:00:00Z", sessionStart: "2026-10-02T10:00:00Z", reference: "ref_abc123" }],
      }),
    );
    const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
    expect(text, "the reference to refund is shown").toContain("ref_abc123");
    expect(text, "where to find the reference").toMatch(/Paystack reference/);
    expect(text, "how to refund").toContain("Refund the charge in the Paystack dashboard");
    expect(text, "how to mark it resolved").toMatch(/Mark refunded/);
    expect(text, "and that marking never moves money").toMatch(/never moves money/i);
  });
  it("shows no runbook when nothing needs a refund", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { MentorRefundList } = await import("@/components/admin/mentor-refund-list");
    const text = renderToStaticMarkup(createElement(MentorRefundList, { rows: [] }));
    expect(text).not.toContain("Refund the charge in the Paystack dashboard");
    expect(text).toContain("None. Every late mentor payment");
  });
});
