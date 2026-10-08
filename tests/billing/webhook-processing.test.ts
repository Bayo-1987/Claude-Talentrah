/**
 * The Paystack webhook and a payment that has not finished verifying yet. A charge.success delivered while Paystack's verify still says processing/pending must NOT be answered 200: Paystack
 * treats 200 as delivered and would never retry, and the payment would sit pending until the reconcile found it. A retryable non-200 (503) makes Paystack deliver it again; the retry, once
 * verify says success, grants exactly once and answers 200. verifyTransaction is faked; the route, fulfillPayment, the database and the ledger are real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`webhook processing test cannot run: ${key} is not set.`);
}
const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

const verify = vi.hoisted(() => vi.fn());
vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, verifyTransaction: verify };
});
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => null }));

const SECRET = `test-signing-${randomUUID()}`;
let userId: string;
let packId: string;
let packPriceNgn: number;
let reference: string;
let transactionId: string;

beforeAll(async () => {
  process.env.PAYSTACK_SECRET_KEY = SECRET;
  userId = (await createTestUser("webhookprocessing")).id;
  const { data: pack } = await admin.from("credit_packs").select("id, price_ngn").limit(1).single();
  packId = pack!.id;
  packPriceNgn = pack!.price_ngn;
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

async function deliver(): Promise<Response> {
  const { POST } = await import("@/app/api/webhooks/paystack/route");
  const body = JSON.stringify({ event: "charge.success", data: { reference } });
  const signature = createHmac("sha512", SECRET).update(body).digest("hex");
  return POST(new Request("http://localhost/api/webhooks/paystack", { method: "POST", body, headers: { "x-paystack-signature": signature } }));
}
const grants = async () => (await admin.from("credit_ledger").select("id", { count: "exact", head: true }).eq("related_entity_id", transactionId)).count ?? 0;

describe("the webhook with a payment that is still processing", () => {
  it("answers a retryable 503 while verify says processing, then 200 and one grant once it says success", async () => {
    reference = `credit_pack_${randomUUID()}`;
    const { data } = await admin
      .from("payment_transactions")
      .insert({ user_id: userId, rail: "paystack", amount: packPriceNgn, currency: "NGN", product_type: "credit_pack", product_id: packId, paystack_reference: reference, status: "pending" })
      .select("id")
      .single();
    transactionId = data!.id;
    const answer = (status: string) => ({ status, reference, amount: Math.round(packPriceNgn * 100), currency: "NGN", channel: "bank_transfer" });

    verify.mockResolvedValue(answer("processing"));
    const first = await deliver();
    expect(first.status, "Paystack must be told to retry").toBe(503);
    expect(await grants()).toBe(0);
    expect((await admin.from("payment_transactions").select("status").eq("id", transactionId).single()).data!.status).toBe("pending");

    verify.mockResolvedValue(answer("success"));
    const retry = await deliver();
    expect(retry.status).toBe(200);
    expect(await grants(), "granted exactly once").toBe(1);

    const again = await deliver(); // Paystack may deliver a success twice
    expect(again.status).toBe(200);
    expect(await grants(), "still once").toBe(1);
  });

  it("an invalid signature is still 401 and a failed payment is still answered 200 (retrying a failure helps nobody)", async () => {
    reference = `credit_pack_${randomUUID()}`;
    const { data } = await admin
      .from("payment_transactions")
      .insert({ user_id: userId, rail: "paystack", amount: packPriceNgn, currency: "NGN", product_type: "credit_pack", product_id: packId, paystack_reference: reference, status: "pending" })
      .select("id")
      .single();
    transactionId = data!.id;
    verify.mockResolvedValue({ status: "failed", reference, amount: Math.round(packPriceNgn * 100), currency: "NGN", channel: "card" });
    expect((await deliver()).status).toBe(200);
    const { POST } = await import("@/app/api/webhooks/paystack/route");
    const bad = await POST(new Request("http://localhost/api/webhooks/paystack", { method: "POST", body: "{}", headers: { "x-paystack-signature": "nope" } }));
    expect(bad.status).toBe(401);
  });
});
