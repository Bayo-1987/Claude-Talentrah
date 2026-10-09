/**
 * A wallet top-up must never be marked paid when the wallet was not credited (audit 9 Oct, "ad wallet top-up").
 *
 * fulfillPayment called credit_ad_wallet and DID NOT READ ITS ERROR, then went on to flip the payment to `success`. A database blip during the credit left a paid, uncredited wallet that
 * nothing would ever retry (a `success` row is final: the next webhook delivery returns `already_processed`). Now the RPC's error is read:
 *   - code 23505 (the unique reference index): another delivery of the same payment (the webhook racing the callback page) already credited it. That is the idempotency working, not a failure.
 *   - anything else: fulfilment THROWS before the status flip, the row stays `pending`, and the webhook's 500 makes Paystack deliver it again; the retry credits once.
 * Paystack's verify is faked; the rows, the RPC, the ledger and fulfillPayment are real. Only the wrapper around the service client can make credit_ad_wallet fail on demand.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import { deleteTestOrgs } from "../support/cleanup";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`ad top-up credit-error test cannot run: ${key} is not set.`);
}
const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const h = vi.hoisted(() => ({ mode: "real" as "real" | "fail" | "duplicate" }));
const verify = vi.hoisted(() => vi.fn());

vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, verifyTransaction: verify };
});
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => null }));
// The real service-role client, except that credit_ad_wallet can be made to fail the two ways that matter.
vi.mock("@/lib/supabase/service-role", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/service-role")>();
  return {
    ...actual,
    createServiceRoleClient: () => {
      const real = actual.createServiceRoleClient();
      return new Proxy(real, {
        get(target, prop, receiver) {
          if (prop !== "rpc") return Reflect.get(target, prop, receiver);
          return (name: string, args?: unknown) => {
            if (name === "credit_ad_wallet" && h.mode === "fail") return Promise.resolve({ data: null, error: { code: "08006", message: "connection failure" } });
            if (name === "credit_ad_wallet" && h.mode === "duplicate") return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } });
            return (target.rpc as (n: string, a?: unknown) => unknown).call(target, name, args);
          };
        },
      });
    },
  };
});

import { fulfillPayment } from "@/lib/billing/fulfill";

const AMOUNT_NGN = 5_000;
let userId = "";
let orgId = "";
let reference = "";
let transactionId = "";

beforeAll(async () => {
  userId = (await createTestUser("topuperr")).id;
  const { data, error } = await admin.from("organizations").insert({ name: `Topup Err Co ${randomUUID().slice(0, 6)}`, domain: `topuperr-${randomUUID().slice(0, 8)}.example`, created_by: userId, verified: false }).select("id").single();
  if (error || !data) throw new Error(`org: ${error?.message}`);
  orgId = data.id;
}, 60_000);

beforeEach(async () => {
  h.mode = "real";
  reference = `ad_wallet_topup_${randomUUID()}`;
  const { data, error } = await admin
    .from("payment_transactions")
    .insert({ user_id: userId, organization_id: orgId, rail: "paystack", amount: AMOUNT_NGN, currency: "NGN", product_type: "ad_wallet_topup", product_id: null, paystack_reference: reference, status: "pending" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`payment: ${error?.message}`);
  transactionId = data.id;
  verify.mockReset();
  verify.mockResolvedValue({ status: "success", reference, amount: AMOUNT_NGN * 100, currency: "NGN", channel: "bank_transfer", authorization: null });
});

afterEach(async () => {
  await admin.from("ad_wallet_ledger").delete().eq("organization_id", orgId);
  await admin.from("ad_wallets").delete().eq("organization_id", orgId);
  await admin.from("payment_transactions").delete().eq("id", transactionId);
});

afterAll(async () => {
  if (orgId) await deleteTestOrgs([orgId]);
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

const status = async () => (await admin.from("payment_transactions").select("status").eq("id", transactionId).single()).data!.status;
const balance = async () => (await admin.from("ad_wallets").select("balance_ngn").eq("organization_id", orgId).maybeSingle()).data?.balance_ngn ?? 0;
const ledgerRows = async () => (await admin.from("ad_wallet_ledger").select("id", { count: "exact", head: true }).eq("paystack_reference", reference)).count ?? 0;

describe("a normal single top-up still works", () => {
  it("credits the wallet once with one ledger row, marks the payment paid, and a repeat delivery changes nothing", async () => {
    const first = await fulfillPayment(reference);
    expect(first.status).toBe("success");
    expect(await balance()).toBe(AMOUNT_NGN);
    expect(await ledgerRows()).toBe(1);
    expect(await status()).toBe("success");
    const again = await fulfillPayment(reference);
    expect(again.status).toBe("already_processed");
    expect(await balance()).toBe(AMOUNT_NGN);
  });
});

describe("a top-up whose credit fails is not marked paid", () => {
  it("fulfilment throws, the payment stays pending and nothing is credited; the retry credits once and only then marks it paid", async () => {
    h.mode = "fail";
    await expect(fulfillPayment(reference)).rejects.toThrow(/credit_ad_wallet/);
    expect(await status(), "MONEY: a paid, uncredited top-up was marked success and can never be retried").toBe("pending");
    expect(await balance()).toBe(0);
    expect(await ledgerRows()).toBe(0);

    h.mode = "real"; // the database is back; Paystack delivers the webhook again
    const retry = await fulfillPayment(reference);
    expect(retry.status).toBe("success");
    expect(await status()).toBe("success");
    expect(await balance()).toBe(AMOUNT_NGN);
    expect(await ledgerRows()).toBe(1);
  });

  it("the error message does not carry the database's text to a caller that might print it", async () => {
    h.mode = "fail";
    const err = await fulfillPayment(reference).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/connection failure/);
  });
});

describe("a duplicate delivery is the idempotency working, not a failure", () => {
  it("23505 from the unique reference index is treated as already credited: no throw, the payment is marked paid", async () => {
    h.mode = "duplicate";
    const result = await fulfillPayment(reference);
    expect(result.status).toBe("success");
    expect(await status()).toBe("success");
  });

  it("the webhook and the callback page racing on one reference: neither throws, the wallet is credited exactly once", async () => {
    const results = await Promise.all([fulfillPayment(reference), fulfillPayment(reference)]);
    expect(results.some((r) => r.status === "success")).toBe(true);
    expect(await balance(), "MONEY: the wallet was credited twice").toBe(AMOUNT_NGN);
    expect(await ledgerRows()).toBe(1);
    expect(await status()).toBe("success");
  });
});
