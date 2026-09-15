/**
 * The credit_pack/pass fulfillment race — the fulfillment-side twin of
 * tests/credits/spend-race.test.ts.
 *
 * WHAT WAS BROKEN. fulfillPayment() read payment_transactions.status,
 * checked it against "pending" in JS, and only much later — after a real
 * Paystack verify call — wrote the grant (credit_ledger insert / user_passes
 * insert) and the status flip, as separate statements with no lock held
 * between the read and the write. Two near-simultaneous webhook deliveries
 * for the same reference (Paystack retries a delivery it didn't get a clean
 * 2xx for — 0043's own work already assumes this happens) both read
 * "pending", both passed the check, and both fulfilled: a customer who paid
 * once for a credit pack or a Pass got it granted twice.
 *
 * THE FIX. fulfill_credit_pack_or_pass() (migration 0159) claims the row with
 * a single conditional UPDATE ... WHERE status = 'pending' and performs the
 * grant inside the SAME function call/transaction, so only the caller that
 * actually claimed the row ever grants anything.
 *
 * verifyTransaction is mocked — there is no way to make the real Paystack API
 * return two genuinely concurrent confirmations for the same reference —
 * while fulfillPayment, the new RPC, the transaction row, the credit grant
 * and the Pass row are all real. Same pattern as
 * tests/billing/fulfill-amount-currency-guard.test.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`fulfillPayment atomic-concurrency test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const verify = vi.hoisted(() => vi.fn());

vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, verifyTransaction: verify };
});

// Sending is not under test.
vi.mock("@/lib/resend/client", () => ({ getResendClient: () => null }));

let userId: string;
let packId: string;
let packCredits: number;
let packPriceNgn: number;
let passId: string;
let passPriceNgn: number;

beforeAll(async () => {
  const user = await createTestUser("fulfillrace");
  userId = user.id;

  const { data: pack, error: packError } = await admin
    .from("credit_packs")
    .select("id, price_ngn, credits")
    .limit(1)
    .single();
  if (packError || !pack) throw new Error("No credit packs seeded — run `npm run seed`.");
  packId = pack.id;
  packPriceNgn = pack.price_ngn;
  packCredits = pack.credits;

  const { data: pass, error: passError } = await admin
    .from("passes")
    .select("id, price_ngn")
    .limit(1)
    .single();
  if (passError || !pass) throw new Error("No passes seeded — run `npm run seed`.");
  passId = pass.id;
  passPriceNgn = pass.price_ngn;
}, 60_000);

afterAll(async () => {
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

let transactionId: string;

async function setUpPendingTransaction(productType: "credit_pack" | "pass") {
  const reference = `${productType}_race_${randomUUID()}`;
  const amount = productType === "credit_pack" ? packPriceNgn : passPriceNgn;
  const productId = productType === "credit_pack" ? packId : passId;

  const { data, error } = await admin
    .from("payment_transactions")
    .insert({
      user_id: userId,
      rail: "paystack",
      amount,
      currency: "NGN",
      product_type: productType,
      product_id: productId,
      paystack_reference: reference,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`could not create pending ${productType} transaction: ${error?.message}`);
  transactionId = data.id;

  verify.mockResolvedValue({
    status: "success",
    reference,
    amount: Math.round(amount * 100),
    currency: "NGN",
    channel: "card",
    authorization: { reusable: true, authorization_code: `AUTH_${randomUUID()}` },
  });

  return reference;
}

afterEach(async () => {
  verify.mockReset();
  if (transactionId) {
    await admin.from("credit_ledger").delete().eq("related_entity_id", transactionId);
    await admin.from("user_passes").delete().eq("payment_transaction_id", transactionId);
    await admin.from("payment_transactions").delete().eq("id", transactionId);
  }
});

async function transactionStatus(): Promise<string> {
  const { data } = await admin.from("payment_transactions").select("status").eq("id", transactionId).single();
  return data!.status;
}

async function creditGrantCountForTransaction(): Promise<number> {
  const { count } = await admin
    .from("credit_ledger")
    .select("id", { count: "exact", head: true })
    .eq("related_entity_id", transactionId);
  return count ?? 0;
}

async function userPassCountForTransaction(): Promise<number> {
  const { count } = await admin
    .from("user_passes")
    .select("id", { count: "exact", head: true })
    .eq("payment_transaction_id", transactionId);
  return count ?? 0;
}

describe("fulfillPayment is atomic for credit_pack and pass", () => {
  it("two concurrent fulfillments of the same credit_pack transaction: exactly one grant", async () => {
    /*
     * The core assertion. Proven to catch the bug: against the pre-fix
     * check-then-act code this fails with two "success" results and two
     * credit_ledger rows for the same transaction id — a customer who paid
     * once granted credits twice.
     */
    const reference = await setUpPendingTransaction("credit_pack");

    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const results = await Promise.all([fulfillPayment(reference), fulfillPayment(reference)]);

    const succeeded = results.filter((r) => r.status === "success");
    const alreadyProcessed = results.filter((r) => r.status === "already_processed");

    expect(succeeded.length, "MONEY BUG: both concurrent fulfillments reported success").toBe(1);
    expect(alreadyProcessed.length, "the loser must report already_processed, not success or an error").toBe(1);

    expect(await transactionStatus()).toBe("success");
    expect(
      await creditGrantCountForTransaction(),
      "MONEY BUG: a customer who paid once for a credit pack was granted credits more than once",
    ).toBe(1);

    const { data: ledgerRow } = await admin
      .from("credit_ledger")
      .select("delta")
      .eq("related_entity_id", transactionId)
      .single();
    expect(ledgerRow?.delta, "the granted amount must be the pack's real credit count").toBe(packCredits);
  });

  it("two concurrent fulfillments of the same pass transaction: exactly one Pass granted", async () => {
    const reference = await setUpPendingTransaction("pass");

    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const results = await Promise.all([fulfillPayment(reference), fulfillPayment(reference)]);

    const succeeded = results.filter((r) => r.status === "success");
    const alreadyProcessed = results.filter((r) => r.status === "already_processed");

    expect(succeeded.length, "MONEY BUG: both concurrent fulfillments reported success").toBe(1);
    expect(alreadyProcessed.length).toBe(1);

    expect(await transactionStatus()).toBe("success");
    expect(
      await userPassCountForTransaction(),
      "MONEY BUG: a customer who paid once for a Pass was granted a Pass more than once",
    ).toBe(1);
  });

  it("ten concurrent fulfillments of the same credit_pack transaction: exactly one grant, at width", async () => {
    // A retried webhook delivery is two; a flaky network retrying harder is
    // more than two. The property has to hold at width, not just for a pair.
    const reference = await setUpPendingTransaction("credit_pack");

    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const results = await Promise.all(Array.from({ length: 10 }, () => fulfillPayment(reference)));

    const succeeded = results.filter((r) => r.status === "success").length;
    expect(succeeded, `MONEY BUG: ${succeeded} of 10 concurrent fulfillments reported success`).toBe(1);
    expect(await creditGrantCountForTransaction()).toBe(1);
  });

  it("sequential fulfillment still works: the second call is a clean no-op", async () => {
    // Positive control — every assertion above is satisfied by a function
    // that refuses everything.
    const reference = await setUpPendingTransaction("credit_pack");

    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const first = await fulfillPayment(reference);
    const second = await fulfillPayment(reference);

    expect(first.status).toBe("success");
    expect(second.status).toBe("already_processed");
    expect(await creditGrantCountForTransaction()).toBe(1);
  });
});
