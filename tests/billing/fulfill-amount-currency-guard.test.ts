/**
 * fulfillPayment checks WHAT Paystack confirmed, not just THAT it confirmed
 * something.
 *
 * Before this, the only gate was `verified.status !== "success"` — the
 * amount and currency Paystack actually reported were never read at all.
 * `transaction.amount`/`transaction.currency` are server-derived (looked up
 * from credit_packs/passes by id in initiatePurchaseAction, never client
 * input), so this isn't guarding a client-tampered number — it's the
 * backstop against any future bug, race, or reference-confusion that leaves
 * a `payment_transactions` row inconsistent with what Paystack actually
 * confirmed, and it's Paystack's own documented integration guidance.
 *
 * `verifyTransaction` is mocked — there is no way to make the real Paystack
 * API return an exact, controlled mismatch — while `fulfillPayment` runs for
 * real against the live database: the transaction row, the credit grant and
 * the ledger are all real. Same pattern as
 * tests/billing/renewal-failure-modes.test.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`fulfillPayment amount/currency guard test cannot run: ${key} is not set.`);
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

beforeAll(async () => {
  const user = await createTestUser("fulfillguard");
  userId = user.id;

  const { data: pack, error } = await admin
    .from("credit_packs")
    .select("id, price_ngn, credits")
    .limit(1)
    .single();
  if (error || !pack) throw new Error("No credit packs seeded — run `npm run seed`.");
  packId = pack.id;
  packPriceNgn = pack.price_ngn;
  packCredits = pack.credits;
}, 60_000);

afterAll(async () => {
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

let reference: string;
let transactionId: string;

/** Fresh pending transaction per test, so one test's mismatch can't leak into another's. */
async function setUpPendingTransaction() {
  reference = `credit_pack_${randomUUID()}`;
  const { data, error } = await admin
    .from("payment_transactions")
    .insert({
      user_id: userId,
      rail: "paystack",
      amount: packPriceNgn,
      currency: "NGN",
      product_type: "credit_pack",
      product_id: packId,
      paystack_reference: reference,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`could not create pending transaction: ${error?.message}`);
  transactionId = data.id;
}

afterEach(async () => {
  verify.mockReset();
  if (transactionId) {
    await admin.from("credit_ledger").delete().eq("related_entity_id", transactionId);
    await admin.from("payment_transactions").delete().eq("id", transactionId);
  }
});

async function transactionStatus(): Promise<string> {
  const { data } = await admin.from("payment_transactions").select("status").eq("id", transactionId).single();
  return data!.status;
}

async function creditGrantsForTransaction(): Promise<number> {
  const { count } = await admin
    .from("credit_ledger")
    .select("id", { count: "exact", head: true })
    .eq("related_entity_id", transactionId);
  return count ?? 0;
}

async function creditedDeltaForTransaction(): Promise<number | null> {
  const { data } = await admin
    .from("credit_ledger")
    .select("delta")
    .eq("related_entity_id", transactionId)
    .maybeSingle();
  return data?.delta ?? null;
}

describe("fulfillPayment checks amount and currency, not just status", () => {
  it("matching amount and currency: fulfills, and credits are actually granted", async () => {
    // Positive control — without this, "mismatch is rejected" could also
    // pass if fulfillPayment rejected everything regardless of what
    // Paystack actually confirmed.
    await setUpPendingTransaction();
    verify.mockResolvedValue({
      status: "success",
      reference,
      amount: Math.round(packPriceNgn * 100),
      currency: "NGN",
      channel: "card",
    });

    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const result = await fulfillPayment(reference);

    expect(result.status).toBe("success");
    expect(await transactionStatus()).toBe("success");
    expect(await creditGrantsForTransaction(), "the matching case must actually grant credits").toBe(1);
    expect(
      await creditedDeltaForTransaction(),
      "the granted amount must be the pack's real credit count, not an arbitrary number",
    ).toBe(packCredits);
  });

  it("amount mismatch: rejected, marked failed, NO credits granted", async () => {
    await setUpPendingTransaction();
    verify.mockResolvedValue({
      status: "success",
      reference,
      amount: Math.round(packPriceNgn * 100) + 100, // one Naira more than owed
      currency: "NGN",
      channel: "card",
    });

    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const result = await fulfillPayment(reference);

    expect(result.status, "MONEY BUG: an amount mismatch still fulfilled").toBe("failed");
    expect(await transactionStatus()).toBe("failed");
    expect(
      await creditGrantsForTransaction(),
      "MONEY BUG: credits were granted for an amount Paystack never actually confirmed",
    ).toBe(0);
  });

  it("currency mismatch: rejected, marked failed, NO credits granted", async () => {
    await setUpPendingTransaction();
    verify.mockResolvedValue({
      status: "success",
      reference,
      amount: Math.round(packPriceNgn * 100),
      currency: "GHS",
      channel: "card",
    });

    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const result = await fulfillPayment(reference);

    expect(result.status, "MONEY BUG: a currency mismatch still fulfilled").toBe("failed");
    expect(await transactionStatus()).toBe("failed");
    expect(await creditGrantsForTransaction()).toBe(0);
  });
});
