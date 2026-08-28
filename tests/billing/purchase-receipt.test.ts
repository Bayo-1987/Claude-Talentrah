/**
 * The purchase confirmation email.
 *
 * WHAT IS ACTUALLY AT RISK. A receipt is a claim about money, and the two
 * ways to get it wrong are both silent: sending one for a payment that did
 * not complete, or sending two for a payment that completed once. Neither
 * surfaces as an error — the first arrives as a receipt for nothing, the
 * second as a suspected double charge.
 *
 * NO NEW IDEMPOTENCY GUARD EXISTS, and that is the thing these tests pin.
 * fulfillPayment's `status !== "pending"` check already makes the whole path
 * run exactly once per reference — the Paystack webhook and the browser
 * callback both call it, and the second returns `already_processed` before
 * reaching the send. Adding a second guard would imply the first is
 * unreliable. So the assertion is not "the email code is idempotent", it is
 * "the existing guard is what makes it so" — which is why the
 * already_processed case is tested through fulfillPayment rather than by
 * calling the sender twice.
 *
 * ONE AUTH USER, CREATED WITHOUT A SESSION. `createUser` alone costs no
 * `verifyOtp`, which is the endpoint this repo's CI keeps exhausting (see
 * docs/ci-and-tooling-gaps.md §3a). A suite that needs a user id but not a
 * logged-in browser should never call createAuthedTestUser.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";

interface SentEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
}

// Typed on the argument so `mock.calls[0][0]` is a real value rather than
// `never` — an untyped vi.fn() infers a zero-length tuple and every read of a
// captured call fails to compile.
const sendMock = vi.fn(async (payload: SentEmail) => ({ data: { id: payload.to }, error: null }));

vi.mock("@/lib/resend/client", () => ({
  getResendClient: () => ({ emails: { send: sendMock } }),
  getContactRecipient: () => "support@talentrah.test",
}));

vi.mock("@/lib/paystack/client", () => ({
  verifyTransaction: vi.fn(async () => ({
    status: "success",
    channel: "bank_transfer",
    authorization: null,
  })),
}));

const { fulfillPayment } = await import("@/lib/billing/fulfill");
const { verifyTransaction } = await import("@/lib/paystack/client");

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`purchase-receipt test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let userId: string;
const references: string[] = [];

async function makeUser(): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `receipt-${randomUUID()}@talentrah.test`,
    email_confirm: true,
    user_metadata: { first_name: "Ada", last_name: "Tester" },
  });
  if (error || !data.user) throw new Error(`fixture user: ${error?.message}`);
  return data.user.id;
}

/** A pending transaction for the given product, ready for fulfilment. */
async function pendingTransaction(
  productType: "credit_pack" | "pass",
  productId: string,
  amount: number,
) {
  const reference = `receipt-test-${randomUUID()}`;
  references.push(reference);
  const { error } = await admin.from("payment_transactions").insert({
    user_id: userId,
    product_type: productType,
    product_id: productId,
    amount,
    currency: "NGN",
    rail: "card",
    status: "pending",
    paystack_reference: reference,
  });
  if (error) throw new Error(`fixture transaction: ${error.message}`);
  return reference;
}

beforeEach(async () => {
  sendMock.mockClear();
  vi.mocked(verifyTransaction).mockResolvedValue({
    status: "success",
    channel: "bank_transfer",
    authorization: null,
  } as never);
  if (!userId) userId = await makeUser();
});

afterAll(async () => {
  // A refused delete resolves with an error rather than throwing.
  const { error } = await admin
    .from("payment_transactions")
    .delete()
    .in("paystack_reference", references);
  if (error) console.error("[receipt cleanup: transactions]", error.message);
  if (userId) await admin.auth.admin.deleteUser(userId).catch(() => {});
});

describe("a completed purchase sends exactly one receipt", () => {
  it("emails on a credit pack, naming the pack, the amount and the reference", async () => {
    const { data: pack } = await admin
      .from("credit_packs")
      .select("id, credits, price_ngn")
      .eq("is_active", true)
      .order("price_ngn")
      .limit(1)
      .single();
    if (!pack) return expect.fail("no active credit pack seeded");

    const reference = await pendingTransaction("credit_pack", pack.id, pack.price_ngn);
    const result = await fulfillPayment(reference);
    expect(result.status).toBe("success");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const sent = sendMock.mock.calls[0][0];
    expect(sent.from).toBe("Talentrah <billing@talentrah.com>");
    expect(sent.text).toContain(pack.credits.toLocaleString());
    // Naira, not kobo — the amount column is already naira and getting this
    // wrong bills the reader 100x in the direction that looks like fraud.
    expect(sent.text).toContain(`₦${pack.price_ngn.toLocaleString()}`);
    expect(sent.text).toContain(reference);
    // visibleName greeting, same as the renewal reminder next door.
    expect(sent.text).toContain("Hi Ada");
  });

  it("emails on a pass, naming the pass", async () => {
    const { data: pass } = await admin
      .from("passes")
      .select("id, name, price_ngn")
      .eq("is_active", true)
      .order("price_ngn")
      .limit(1)
      .single();
    if (!pass) return expect.fail("no active pass seeded");

    const reference = await pendingTransaction("pass", pass.id, pass.price_ngn);
    expect((await fulfillPayment(reference)).status).toBe("success");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const sent = sendMock.mock.calls[0][0];
    expect(sent.subject).toContain(pass.name);
    expect(sent.text).toContain(reference);
  });
});

describe("and nothing else does", () => {
  it("does NOT email again when the same reference is fulfilled twice", async () => {
    const { data: pack } = await admin
      .from("credit_packs")
      .select("id, price_ngn")
      .eq("is_active", true)
      .limit(1)
      .single();
    if (!pack) return expect.fail("no active credit pack seeded");

    const reference = await pendingTransaction("credit_pack", pack.id, pack.price_ngn);
    expect((await fulfillPayment(reference)).status).toBe("success");
    expect(sendMock).toHaveBeenCalledTimes(1);

    /*
     * The webhook-then-callback case, which is the normal one rather than an
     * edge: both paths call fulfillPayment for the same reference. A second
     * receipt reads as a second charge.
     */
    sendMock.mockClear();
    const second = await fulfillPayment(reference);
    expect(second.status).toBe("already_processed");
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("does NOT email when Paystack says the payment failed", async () => {
    const { data: pack } = await admin
      .from("credit_packs")
      .select("id, price_ngn")
      .eq("is_active", true)
      .limit(1)
      .single();
    if (!pack) return expect.fail("no active credit pack seeded");

    vi.mocked(verifyTransaction).mockResolvedValue({
      status: "failed",
      channel: null,
      authorization: null,
    } as never);

    const reference = await pendingTransaction("credit_pack", pack.id, pack.price_ngn);
    const result = await fulfillPayment(reference);

    expect(result.status).toBe("failed");
    // A receipt for a payment that did not go through is worse than none.
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("does NOT email for an ad wallet top-up — employer surface, different recipient", async () => {
    // product_id is null for a top-up (0050) and there is no organisation
    // here, so nothing is granted; the point is only that no seeker receipt
    // is sent for an employer's payment.
    const reference = `receipt-test-${randomUUID()}`;
    references.push(reference);
    const { error } = await admin.from("payment_transactions").insert({
      user_id: userId,
      product_type: "ad_wallet_topup",
      product_id: null,
      amount: 5000,
      currency: "NGN",
      rail: "card",
      status: "pending",
      paystack_reference: reference,
    });
    if (error) throw new Error(`fixture transaction: ${error.message}`);

    expect((await fulfillPayment(reference)).status).toBe("success");
    expect(sendMock).not.toHaveBeenCalled();
  });
});
