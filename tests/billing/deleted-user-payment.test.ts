/**
 * send-512 / PR 0 — a payment that arrives for a user whose account no longer exists.
 *
 * Migration 0209 makes deleting a user DETACH their payments (user_id becomes null) instead of deleting them. So a Paystack confirmation can
 * still arrive for a reference whose owner is gone (an abandoned checkout paid after the account was deleted). There is nobody to grant it to:
 *   - fulfillPayment verifies it with Paystack, and when it really was paid records it as `needs_refund`, alerts the operator, grants NOTHING;
 *   - the webhook answers 200, never a 5xx that would make Paystack retry a payment no retry can fulfil;
 *   - a retried delivery does not re-alert.
 *
 * Runs against a fake service client (no database), so it runs everywhere; tests/rls/money-survives-user-deletion.test.ts covers the real
 * cascade in CI's database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, randomBytes } from "node:crypto";

interface Row {
  id: string;
  user_id: string | null;
  status: string;
  amount: number;
  currency: string;
  product_type: string;
  product_id: string | null;
  organization_id: string | null;
  paystack_reference: string;
}

const h = vi.hoisted(() => ({
  row: null as unknown as Row,
  touched: [] as string[],
  rpcCalls: [] as string[],
  updateError: null as null | { message: string },
  verify: vi.fn(),
  alertDeleted: vi.fn(async () => undefined),
  alertMentor: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from(table: string) {
      h.touched.push(table);
      const filters: Array<[string, unknown]> = [];
      let op: "select" | "update" = "select";
      let patch: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        select: () => q,
        update: (v: Record<string, unknown>) => {
          op = "update";
          patch = v;
          return q;
        },
        eq: (c: string, v: unknown) => {
          filters.push([c, v]);
          return q;
        },
        single: async () => ({ data: h.row, error: null }),
        then: (resolve: (v: unknown) => unknown) => {
          if (op !== "update") return resolve({ data: [], error: null });
          if (h.updateError) return resolve({ data: null, error: h.updateError });
          const matches = filters.every(([c, v]) => (h.row as unknown as Record<string, unknown>)[c] === v);
          if (matches && table === "payment_transactions") Object.assign(h.row, patch);
          return resolve({ data: matches ? [{ id: h.row.id }] : [], error: null });
        },
      };
      return q;
    },
    rpc: async (name: string) => {
      h.rpcCalls.push(name);
      return { data: [], error: null };
    },
  }),
}));

vi.mock("@/lib/paystack/client", () => ({ verifyTransaction: h.verify }));
vi.mock("@/lib/mentorship/refund-alert", () => ({ alertDeletedUserPayment: h.alertDeleted, alertPaymentNeedsRefund: h.alertMentor }));
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => null }));
vi.mock("@/lib/analytics/posthog", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/analytics/posthog")>()), captureEvent: vi.fn() }));

const REF = "credit_pack_deleted-user-ref";

function deletedUserRow(over: Partial<Row> = {}): Row {
  return {
    id: "tx-1",
    user_id: null,
    status: "pending",
    amount: 6500,
    currency: "NGN",
    product_type: "credit_pack",
    product_id: "pack-1",
    organization_id: null,
    paystack_reference: REF,
    ...over,
  };
}

const paid = { status: "success", amount: 650_000, currency: "NGN", channel: "card", authorization: null };

beforeEach(() => {
  h.row = deletedUserRow();
  h.touched.length = 0;
  h.rpcCalls.length = 0;
  h.updateError = null;
  h.verify.mockReset();
  h.verify.mockResolvedValue(paid);
  h.alertDeleted.mockClear();
  h.alertMentor.mockClear();
});

async function fulfill(reference = REF, expectedUserId?: string) {
  const mod = await import("@/lib/billing/fulfill");
  return mod.fulfillPayment(reference, expectedUserId);
}

describe("fulfillPayment for a deleted user's payment", () => {
  it("a verified, paid charge is recorded as needs_refund, the operator is alerted once, and NOTHING is granted", async () => {
    const result = await fulfill();
    expect(result.status).toBe("needs_refund");
    expect(h.row.status).toBe("needs_refund");
    expect(h.alertDeleted).toHaveBeenCalledTimes(1);
    expect(h.alertDeleted).toHaveBeenCalledWith({ reference: REF, amountNgn: 6500, productType: "credit_pack" });
    expect(h.rpcCalls, "no credit pack / pass grant").toEqual([]);
    expect(h.touched.filter((t) => t !== "payment_transactions"), "no other table written or read").toEqual([]);
  });

  it("a retried delivery is already_processed and does not alert again", async () => {
    await fulfill();
    h.alertDeleted.mockClear();
    const again = await fulfill();
    expect(again.status).toBe("already_processed");
    expect(h.alertDeleted).not.toHaveBeenCalled();
    expect(h.row.status).toBe("needs_refund");
  });

  it("Paystack saying it was NOT paid is the ordinary failed path: no needs_refund, no alert", async () => {
    h.verify.mockResolvedValue({ ...paid, status: "failed" });
    const result = await fulfill();
    expect(result.status).toBe("failed");
    expect(h.row.status).toBe("failed");
    expect(h.alertDeleted).not.toHaveBeenCalled();
  });

  it("an amount mismatch is failed too (the ground-truth check still runs before the deleted-user branch)", async () => {
    h.verify.mockResolvedValue({ ...paid, amount: 1 });
    const result = await fulfill();
    expect(result.status).toBe("failed");
    expect(h.alertDeleted).not.toHaveBeenCalled();
  });

  it("a session-scoped caller (the checkout callback) can never reach it: not_found, nothing verified", async () => {
    const result = await fulfill(REF, "some-signed-in-user");
    expect(result.status).toBe("not_found");
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.alertDeleted).not.toHaveBeenCalled();
  });

  it("a database failure while recording it DOES throw (a transient fault; a retry is right)", async () => {
    h.updateError = { message: "connection reset" };
    await expect(fulfill()).rejects.toThrow(/needs_refund/);
  });

  it("an ordinary payment (a user id present) never takes this branch", async () => {
    h.row = deletedUserRow({ user_id: "user-1" });
    const result = await fulfill();
    expect(result.status).not.toBe("needs_refund");
    expect(h.alertDeleted).not.toHaveBeenCalled();
  });
});

describe("the Paystack webhook answers 200 for a deleted user's charge", () => {
  // Generated per run: the repo's secret scanner (.gitleaks.toml, talentrah-hardcoded-credential) rejects a literal credential-shaped value, even in a test.
  const SECRET = randomBytes(16).toString("hex");
  const sign = (body: string) => createHmac("sha512", SECRET).update(body).digest("hex");
  const post = async (body: string) => {
    process.env.PAYSTACK_SECRET_KEY = SECRET;
    const { POST } = await import("@/app/api/webhooks/paystack/route");
    return POST(new Request("http://localhost/api/webhooks/paystack", { method: "POST", body, headers: { "x-paystack-signature": sign(body) } }));
  };
  const charge = JSON.stringify({ event: "charge.success", data: { reference: REF } });

  it("200 with received:true, the row needs_refund, one alert", async () => {
    const res = await post(charge);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(h.row.status).toBe("needs_refund");
    expect(h.alertDeleted).toHaveBeenCalledTimes(1);
  });

  it("the second delivery of the same event is also a 200 and does not alert again", async () => {
    await post(charge);
    h.alertDeleted.mockClear();
    const res = await post(charge);
    expect(res.status).toBe(200);
    expect(h.alertDeleted).not.toHaveBeenCalled();
  });
});
