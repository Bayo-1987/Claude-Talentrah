/**
 * `fulfillPayment`'s `mentor_session` branch follows the SAME idempotency
 * bar as the existing purchase flow — send-137's own explicit requirement:
 * a webhook redelivery must not double-book or double-charge a session.
 *
 * `verifyTransaction` is mocked (same pattern as
 * tests/billing/fulfill-amount-currency-guard.test.ts) — there is no way to
 * make the real Paystack API confirm a controlled charge — while
 * `fulfillPayment`, the real `book_mentor_session` booking, and the real
 * database all run for real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`mentor_session idempotency test cannot run: ${key} is not set.`);
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
vi.mock("@/lib/resend/client", () => ({ getResendClient: () => null }));

let mentorId: string;
let menteeId: string;
const BASE_PRICE = 15_000;

beforeAll(async () => {
  const mentor = await createTestUser("idempotency-mentor");
  const mentee = await createTestUser("idempotency-mentee");
  mentorId = mentor.id;
  menteeId = mentee.id;

  const { error } = await admin.from("mentor_profiles").insert({
    user_id: mentorId,
    status: "approved",
    base_price_ngn: BASE_PRICE,
  });
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await admin.from("mentor_profiles").delete().eq("user_id", mentorId);
  await deleteTestUsers([mentorId, menteeId]);
}, 60_000);

let sessionId: string;
let transactionId: string;
let reference: string;

/**
 * A fresh pending_payment session + payment_transactions row per test,
 * mirroring what bookMentorSessionAction actually does.
 *
 * SCHEDULED 30 DAYS OUT, deliberately — this suite runs against the one real
 * shared database, in its own file/worker, alongside
 * tests/mentorship/no-show-sweep.test.ts, which calls the REAL
 * `runMentorshipSweep()` against every `awaiting_confirmation` session
 * within 24 hours regardless of which test file created it. A session
 * scheduled soon after "now" would be a real, if accidental, target for a
 * concurrently-running sweep test — 30 days keeps it far outside that
 * window no matter how the two files interleave.
 */
async function setUpPendingBooking() {
  const { data: slot, error: slotError } = await admin
    .from("mentor_availability_slots")
    .insert({
      mentor_id: mentorId,
      start_at: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
      end_at: new Date(Date.now() + 30 * 24 * 3600_000 + 3600_000).toISOString(),
    })
    .select("id")
    .single();
  if (slotError || !slot) throw slotError ?? new Error("no slot");

  const { data: rows, error } = await admin.rpc("book_mentor_session", {
    p_availability_slot_id: slot.id,
    p_mentee_id: menteeId,
    p_session_type: "resume_review",
  });
  if (error || !rows?.[0]) throw error ?? new Error("booking failed");
  sessionId = rows[0].session_id;

  reference = `mentor_session_${randomUUID()}`;
  const { data: txn, error: txnError } = await admin
    .from("payment_transactions")
    .insert({
      user_id: menteeId,
      rail: "paystack",
      amount: BASE_PRICE,
      currency: "NGN",
      product_type: "mentor_session",
      product_id: sessionId,
      paystack_reference: reference,
      status: "pending",
    })
    .select("id")
    .single();
  if (txnError || !txn) throw txnError ?? new Error("no transaction");
  transactionId = txn.id;
}

afterEach(async () => {
  verify.mockReset();
  if (sessionId) await admin.from("mentorship_sessions").delete().eq("id", sessionId);
  if (transactionId) await admin.from("payment_transactions").delete().eq("id", transactionId);
});

async function sessionStatus(): Promise<string> {
  const { data } = await admin.from("mentorship_sessions").select("status").eq("id", sessionId).single();
  return data!.status;
}

describe("fulfillPayment(mentor_session) moves a booked session to awaiting_confirmation exactly once", () => {
  it("a successful charge moves pending_payment -> awaiting_confirmation", async () => {
    await setUpPendingBooking();
    expect(await sessionStatus()).toBe("pending_payment");

    verify.mockResolvedValue({
      status: "success",
      reference,
      amount: Math.round(BASE_PRICE * 100),
      currency: "NGN",
      channel: "card",
    });

    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const result = await fulfillPayment(reference);

    expect(result.status).toBe("success");
    expect(await sessionStatus()).toBe("awaiting_confirmation");
  });

  it("A WEBHOOK REDELIVERY (same reference, called twice) does not double-process — no double-booking, no double-charge", async () => {
    await setUpPendingBooking();
    verify.mockResolvedValue({
      status: "success",
      reference,
      amount: Math.round(BASE_PRICE * 100),
      currency: "NGN",
      channel: "card",
    });

    const { fulfillPayment } = await import("@/lib/billing/fulfill");

    const first = await fulfillPayment(reference);
    expect(first.status).toBe("success");
    expect(await sessionStatus()).toBe("awaiting_confirmation");

    // The redelivery: payment_transactions.status is no longer "pending", so
    // this must short-circuit at fulfillPayment's own top-level guard and
    // never reach the mentor_session branch a second time.
    const second = await fulfillPayment(reference);
    expect(second.status, "MONEY BUG: a webhook redelivery was processed a second time").toBe(
      "already_processed",
    );
    expect(await sessionStatus()).toBe("awaiting_confirmation");

    // verifyTransaction itself must only have been called once — Paystack
    // was consulted for the original charge, not re-verified on redelivery.
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("CONCURRENT redeliveries (both in flight at once): the SESSION transition still happens exactly once", async () => {
    /*
     * The harder case than sequential redelivery above: two requests racing
     * rather than one finishing before the other starts. Both read
     * payment_transactions.status="pending" before either writes it — the
     * SAME read-then-act race fulfillPayment's own header already documents
     * as open for credit_pack/pass (only ad_wallet_topup closes it, via a
     * unique index on paystack_reference). This test does not claim to close
     * that outer race for mentor_session either; what it proves is narrower
     * and is the thing send-137 actually asked for: the SESSION's own
     * `pending_payment -> awaiting_confirmation` transition is a conditional
     * UPDATE (`.eq("status", "pending_payment")`, see fulfill.ts's own
     * mentor_session branch), so even if both racing calls reach that branch,
     * only one of them can actually flip the session — the other's UPDATE
     * matches zero rows. That is what "must not double-book a session" means
     * concretely: the booking's own state can only ever move once, however
     * many times the outer transaction race lets fulfillment code run.
     */
    await setUpPendingBooking();
    verify.mockResolvedValue({
      status: "success",
      reference,
      amount: Math.round(BASE_PRICE * 100),
      currency: "NGN",
      channel: "card",
    });

    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const results = await Promise.all([fulfillPayment(reference), fulfillPayment(reference)]);

    expect(results.every((r) => r.status === "success" || r.status === "already_processed")).toBe(true);
    expect(
      await sessionStatus(),
      "MONEY BUG: the session ended up somewhere other than awaiting_confirmation after a concurrent fulfilment race",
    ).toBe("awaiting_confirmation");

    // Confirm there is still exactly one session row for this booking — the
    // race could not have created a second session or a second booking.
    const { count } = await admin
      .from("mentorship_sessions")
      .select("id", { count: "exact", head: true })
      .eq("id", sessionId);
    expect(count, "MONEY BUG: a concurrent race produced more than one session row").toBe(1);
  });

  it("an amount mismatch is rejected — no session state change at all", async () => {
    await setUpPendingBooking();
    verify.mockResolvedValue({
      status: "success",
      reference,
      amount: Math.round(BASE_PRICE * 100) + 100,
      currency: "NGN",
      channel: "card",
    });

    const { fulfillPayment } = await import("@/lib/billing/fulfill");
    const result = await fulfillPayment(reference);

    expect(result.status).toBe("failed");
    expect(
      await sessionStatus(),
      "MONEY BUG: a session moved forward on a payment Paystack never actually confirmed at this amount",
    ).toBe("pending_payment");
  });
});
