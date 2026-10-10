/**
 * P1 (money): a payment that has not finished is NOT a failed payment.
 *
 * fulfillPayment used to write status = 'failed' permanently on ANY Paystack answer other than "success". But a slow rail (bank transfer, USSD, mobile money, direct debit) can answer
 * ongoing / pending / processing at the moment the buyer is sent back to us, and a customer can still pay an abandoned checkout link. A row marked 'failed' is then "already processed",
 * so the later successful charge granted NOTHING: paid, nothing delivered.
 *
 * Paystack's verify statuses (documented by Paystack, checked by the CTO on 8 Oct 2026): success; failed; abandoned (the customer has not completed it); pending (in progress);
 * processing (pending, for direct debit); queued (bulk charge only); ongoing; reversed (a refund or chargeback). The rule now: only failed and reversed (and an amount/currency mismatch,
 * which is a different kind of fault) are terminal. Everything else, including a status nobody has seen before, leaves the row pending and answers "processing".
 *
 * verifyTransaction is faked (Paystack cannot be made to answer exactly this on demand); fulfillPayment runs for real against the live database, rows and ledger included, the same pattern as
 * tests/billing/fulfill-amount-currency-guard.test.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`fulfillPayment non-terminal status test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const verify = vi.hoisted(() => vi.fn());
vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, verifyTransaction: verify };
});
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => null }));

let userId: string;
let packId: string;
let packCredits: number;
let packPriceNgn: number;
let reference: string;
let transactionId: string;

beforeAll(async () => {
  userId = (await createTestUser("fulfillnonterminal")).id;
  const { data: pack, error } = await admin.from("credit_packs").select("id, price_ngn, credits").limit(1).single();
  if (error || !pack) throw new Error("No credit packs seeded — run `npm run seed`.");
  packId = pack.id;
  packPriceNgn = pack.price_ngn;
  packCredits = pack.credits;
}, 60_000);

afterAll(async () => {
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

afterEach(async () => {
  verify.mockReset();
  if (transactionId) {
    await admin.from("credit_ledger").delete().eq("related_entity_id", transactionId);
    await admin.from("payment_transactions").delete().eq("id", transactionId);
  }
});

async function pendingTransaction() {
  reference = `credit_pack_${randomUUID()}`;
  const { data, error } = await admin
    .from("payment_transactions")
    .insert({ user_id: userId, rail: "paystack", amount: packPriceNgn, currency: "NGN", product_type: "credit_pack", product_id: packId, paystack_reference: reference, status: "pending" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`could not create pending transaction: ${error?.message}`);
  transactionId = data.id;
}
const answer = (status: string, extra: Record<string, unknown> = {}) => ({ status, reference, amount: Math.round(packPriceNgn * 100), currency: "NGN", channel: "bank_transfer", ...extra });
const rowStatus = async () => (await admin.from("payment_transactions").select("status").eq("id", transactionId).single()).data!.status;
const grants = async () => (await admin.from("credit_ledger").select("id", { count: "exact", head: true }).eq("related_entity_id", transactionId)).count ?? 0;

describe("a payment Paystack has not finished stays pending", () => {
  it.each(["ongoing", "pending", "processing", "queued", "abandoned", "a_status_nobody_has_seen"])("verify says %s: the row stays pending, nothing is granted, the answer is non-terminal", async (status) => {
    await pendingTransaction();
    verify.mockResolvedValue(answer(status));
    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const result = await fulfillPayment(reference, userId);
    expect(result.status).toBe("processing");
    expect(await rowStatus(), `MONEY BUG: a "${status}" payment was made terminal`).toBe("pending");
    expect(await grants()).toBe(0);
  });

  it("the payment that completes LATER is granted exactly once (the bug: it was ignored as already_processed)", async () => {
    await pendingTransaction();
    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    verify.mockResolvedValue(answer("pending")); // the buyer is sent back before the transfer settles
    expect((await fulfillPayment(reference, userId)).status).toBe("processing");
    verify.mockResolvedValue(answer("success")); // the webhook, or the buyer coming back, after it settled
    expect((await fulfillPayment(reference)).status).toBe("success");
    expect(await rowStatus()).toBe("success");
    expect(await grants(), "granted exactly once").toBe(1);
    expect((await admin.from("credit_ledger").select("delta").eq("related_entity_id", transactionId).single()).data!.delta).toBe(packCredits);
    expect((await fulfillPayment(reference)).status).toBe("already_processed");
    expect(await grants(), "still once after a third call").toBe(1);
  });

  it("an abandoned checkout that the customer pays afterwards is granted (the link still works)", async () => {
    await pendingTransaction();
    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    verify.mockResolvedValue(answer("abandoned"));
    expect((await fulfillPayment(reference, userId)).status).toBe("processing");
    verify.mockResolvedValue(answer("success"));
    expect((await fulfillPayment(reference)).status).toBe("success");
    expect(await grants()).toBe(1);
  });
});

describe("only a real failure is terminal", () => {
  it.each(["failed", "reversed"])("verify says %s: the row is marked failed, nothing is granted", async (status) => {
    await pendingTransaction();
    verify.mockResolvedValue(answer(status));
    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    expect((await fulfillPayment(reference, userId)).status).toBe("failed");
    expect(await rowStatus()).toBe("failed");
    expect(await grants()).toBe(0);
  });

  it("an amount mismatch on a success is still failed", async () => {
    await pendingTransaction();
    verify.mockResolvedValue(answer("success", { amount: Math.round(packPriceNgn * 100) + 100 }));
    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    expect((await fulfillPayment(reference)).status).toBe("failed");
    expect(await rowStatus()).toBe("failed");
    expect(await grants()).toBe(0);
  });

  it("a 'failed' answer that arrives after the row already became success does not overwrite it", async () => {
    await pendingTransaction();
    // While verify is in flight the webhook's success lands: the row is success by the time this call tries to write 'failed'.
    verify.mockImplementation(async () => {
      await admin.from("payment_transactions").update({ status: "success" }).eq("id", transactionId);
      return answer("failed");
    });
    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    await fulfillPayment(reference, userId);
    expect(await rowStatus(), "a late 'failed' must not undo a success").toBe("success");
  });

  it("a Paystack outage (verify throws) leaves the row pending and surfaces the error to the caller", async () => {
    await pendingTransaction();
    verify.mockRejectedValue(new Error("Paystack verification failed: 503"));
    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    await expect(fulfillPayment(reference, userId)).rejects.toThrow();
    expect(await rowStatus()).toBe("pending");
  });
});
