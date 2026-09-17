/**
 * `fulfillPayment` (src/lib/billing/fulfill.ts) is the other of the 2 (of 8)
 * new PostHog call sites that can genuinely be unit-tested by direct call —
 * it takes no session, only `createServiceRoleClient()` — confirmed by
 * grepping the file for createClient/cookies and finding neither, same
 * check as tests/tailoring/posthog-instrumentation.test.ts's own header.
 *
 * Proves the two scoping decisions the credit_purchase_completed event's
 * placement depends on, both explicitly requested rather than assumed:
 *   1. Fires on the credit_pack/pass branch's own "success" return, with
 *      amount_ngn/product_type matching the real transaction row.
 *   2. Does NOT fire a second time when a webhook/callback race lands the
 *      second caller on "already_processed" — fulfillPayment's own header
 *      documents this race as expected, and double-firing here would
 *      double-count one real purchase as two in PostHog.
 *
 * (NOT covered here: that the shared final "success" return — reached by
 * talent_directory_subscription/ad_wallet_topup/mentor_session — never
 * fires this event either. That's a structural property of where the
 * capture call is lexically placed (inside the credit_pack/pass branch,
 * before ITS OWN early return, never reached by the other branches), not a
 * new behaviour that needs its own heavy fixture — building a real
 * org/ad-wallet or mentor-session-booking fixture just to re-prove "code
 * inside an if-branch that returns doesn't run for other branches" isn't a
 * proportionate use of either.)
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`fulfillPayment posthog instrumentation test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const verify = vi.hoisted(() => vi.fn());
const captureEvent = vi.hoisted(() => vi.fn());

vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, verifyTransaction: verify };
});
vi.mock("@/lib/resend/client", () => ({ getResendClient: () => null }));
vi.mock("@/lib/analytics/posthog", () => ({ captureEvent }));

const { fulfillPayment } = await import("@/lib/billing/fulfill");

let userId: string;
let packId: string;
let packPriceNgn: number;

beforeAll(async () => {
  const user = await createTestUser("fulfillposthog");
  userId = user.id;

  const { data: pack, error } = await admin
    .from("credit_packs")
    .select("id, price_ngn")
    .limit(1)
    .single();
  if (error || !pack) throw new Error("No credit packs seeded — run `npm run seed`.");
  packId = pack.id;
  packPriceNgn = pack.price_ngn;
}, 60_000);

afterAll(async () => {
  if (userId) await deleteTestUsers([userId]);
}, 60_000);

let reference: string;
let transactionId: string;

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
  captureEvent.mockClear();
  if (transactionId) {
    await admin.from("credit_ledger").delete().eq("related_entity_id", transactionId);
    await admin.from("payment_transactions").delete().eq("id", transactionId);
  }
});

describe("fulfillPayment fires credit_purchase_completed with the right shape, once", () => {
  it("fires with amount_ngn/product_type matching the real transaction, on success", async () => {
    await setUpPendingTransaction();
    verify.mockResolvedValue({
      status: "success",
      reference,
      amount: Math.round(packPriceNgn * 100),
      currency: "NGN",
      channel: "card",
    });

    const result = await fulfillPayment(reference);
    expect(result.status).toBe("success");
    expect(captureEvent).toHaveBeenCalledTimes(1);
    expect(captureEvent).toHaveBeenCalledWith(userId, "credit_purchase_completed", {
      amount_ngn: packPriceNgn,
      product_type: "credit_pack",
    });
  });

  it("does not fire again on the already_processed branch — the webhook/callback race this function's own header documents as expected", async () => {
    await setUpPendingTransaction();
    verify.mockResolvedValue({
      status: "success",
      reference,
      amount: Math.round(packPriceNgn * 100),
      currency: "NGN",
      channel: "card",
    });

    const first = await fulfillPayment(reference);
    expect(first.status).toBe("success");
    expect(captureEvent).toHaveBeenCalledTimes(1);

    captureEvent.mockClear();
    const second = await fulfillPayment(reference);
    expect(second.status).toBe("already_processed");
    expect(captureEvent).not.toHaveBeenCalled();
  });
});
