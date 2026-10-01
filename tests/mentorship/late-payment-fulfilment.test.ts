/**
 * send-502 / S15 — a Paystack confirmation that arrives for a booking that already lapsed.
 *
 * The scenario is not hypothetical: the owner's own 17 Sep booking has an abandoned, still-pending Paystack checkout. Once the
 * sweep expires that booking, paying that old link would reach fulfillPayment's mentor_session branch, whose conditional
 * UPDATE (`status = 'pending_payment'`) matches nothing and used to fall straight through to "mark the transaction success":
 * the charge recorded, the booking untouched, the money kept and nobody told. This pins what it does now:
 *
 *   - slot still free and ahead  -> the booking is REINSTATED (awaiting the mentor), with its receipt;
 *   - otherwise                  -> the session is marked payment_needs_refund, the failure is LOUD in the log, no purchase
 *                                   receipt is sent for something that will be refunded, and the admin ops badge counts it.
 *
 * Real database; Paystack's verify is mocked (there is no way to make the real API confirm a controlled charge), same as
 * every other fulfilment test here.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`late-payment fulfilment test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const verify = vi.hoisted(() => vi.fn());
vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, verifyTransaction: verify };
});
const send = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("@/lib/resend/client", () => ({ getResendClient: () => ({ emails: { send } }) }));
vi.mock("@/lib/analytics/posthog", () => ({ captureEvent: vi.fn() }));

const { fulfillPayment } = await import("@/lib/billing/fulfill");

const HOUR = 3_600_000;
const PRICE = 25_000;
let mentorId: string;
let menteeId: string;
const sessionIds: string[] = [];
const slotIds: string[] = [];
const transactionIds: string[] = [];

beforeAll(async () => {
  const [mentor, mentee] = await Promise.all([createTestUser("latepay-mentor"), createTestUser("latepay-mentee")]);
  mentorId = mentor.id;
  menteeId = mentee.id;
  const { error } = await admin.from("mentor_profiles").upsert({ user_id: mentorId, status: "approved", base_price_ngn: 20_000 });
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await admin.from("mentor_profiles").delete().eq("user_id", mentorId);
  await deleteTestUsers([mentorId, menteeId]);
}, 60_000);

afterEach(async () => {
  verify.mockReset();
  send.mockClear();
  vi.restoreAllMocks();
  if (transactionIds.length) await admin.from("payment_transactions").delete().in("id", transactionIds.splice(0));
  if (sessionIds.length) await admin.from("mentorship_sessions").delete().in("id", sessionIds.splice(0));
  if (slotIds.length) await admin.from("mentor_availability_slots").delete().in("id", slotIds.splice(0));
});

/** A lapsed booking (`status`) with a still-pending Paystack transaction, the slot starting `startOffsetHours` from now. */
async function lapsedBookingWithPendingPayment(status: "expired_unpaid" | "cancelled_by_mentee", startOffsetHours: number, slotBooked: boolean) {
  const start = new Date(Date.now() + startOffsetHours * HOUR).toISOString();
  const { data: slot, error: slotError } = await admin
    .from("mentor_availability_slots")
    .insert({ mentor_id: mentorId, start_at: start, end_at: new Date(Date.parse(start) + HOUR).toISOString(), is_booked: slotBooked })
    .select("id")
    .single();
  if (slotError || !slot) throw slotError ?? new Error("no slot");
  slotIds.push(slot.id);

  const { data: session, error } = await admin
    .from("mentorship_sessions")
    .insert({
      mentor_id: mentorId,
      mentee_id: menteeId,
      availability_slot_id: slot.id,
      session_type: "mock_interview",
      scheduled_start: start,
      scheduled_end: new Date(Date.parse(start) + HOUR).toISOString(),
      price_ngn: PRICE,
      platform_commission_ngn: 3_750,
      mentor_payout_ngn: 21_250,
      status,
    })
    .select("id")
    .single();
  if (error || !session) throw error ?? new Error("no session");
  sessionIds.push(session.id);

  const reference = `mentor_session_${randomUUID()}`;
  const { data: txn, error: txnError } = await admin
    .from("payment_transactions")
    .insert({ user_id: menteeId, rail: "paystack", amount: PRICE, currency: "NGN", product_type: "mentor_session", product_id: session.id, paystack_reference: reference, status: "pending" })
    .select("id")
    .single();
  if (txnError || !txn) throw txnError ?? new Error("no transaction");
  transactionIds.push(txn.id);

  verify.mockResolvedValue({ status: "success", reference, amount: PRICE * 100, currency: "NGN", channel: "card" });
  return { sessionId: session.id, slotId: slot.id, reference, transactionId: txn.id };
}

const sessionStatus = async (id: string) => (await admin.from("mentorship_sessions").select("status").eq("id", id).single()).data?.status;
const txnStatus = async (id: string) => (await admin.from("payment_transactions").select("status").eq("id", id).single()).data?.status;

describe("a payment lands on a booking that already lapsed", () => {
  it("REINSTATES it when the slot is still free and ahead: awaiting the mentor, the slot locked again, the charge recorded", async () => {
    const b = await lapsedBookingWithPendingPayment("cancelled_by_mentee", 24, false);
    const result = await fulfillPayment(b.reference);
    expect(result.status).toBe("success");
    expect(await sessionStatus(b.sessionId)).toBe("awaiting_confirmation");
    expect((await admin.from("mentor_availability_slots").select("is_booked").eq("id", b.slotId).single()).data?.is_booked).toBe(true);
    expect(await txnStatus(b.transactionId)).toBe("success");
  });

  it("marks it payment_needs_refund when the slot has already started, and says so LOUDLY in the log", async () => {
    const b = await lapsedBookingWithPendingPayment("expired_unpaid", -48, false);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await fulfillPayment(b.reference);

    expect(result.status).toBe("success");
    expect(await sessionStatus(b.sessionId)).toBe("payment_needs_refund");
    // The money DID move, so the transaction is recorded as it is: success. It is not "failed", and it is not silently dropped.
    expect(await txnStatus(b.transactionId)).toBe("success");
    const logged = errors.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toMatch(/NEEDS REFUND/);
    expect(logged).toContain(b.sessionId);
    expect(logged).toContain(b.reference);
  });

  it("marks it payment_needs_refund when the slot has since been booked by someone else", async () => {
    const b = await lapsedBookingWithPendingPayment("cancelled_by_mentee", 24, true); // slot re-taken
    vi.spyOn(console, "error").mockImplementation(() => {});
    await fulfillPayment(b.reference);
    expect(await sessionStatus(b.sessionId)).toBe("payment_needs_refund");
  });

  it("sends NO purchase receipt for a payment that is going to be refunded, but does send one when it is reinstated", async () => {
    const needsRefund = await lapsedBookingWithPendingPayment("expired_unpaid", -48, false);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await fulfillPayment(needsRefund.reference);
    expect(send, "a receipt for a purchase that will be refunded is a promise nothing keeps").not.toHaveBeenCalled();

    const reinstated = await lapsedBookingWithPendingPayment("cancelled_by_mentee", 24, false);
    await fulfillPayment(reinstated.reference);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a payment for a normal pending_payment booking is untouched by all of this (the unchanged path)", async () => {
    const start = new Date(Date.now() + 24 * HOUR).toISOString();
    const { data: slot } = await admin.from("mentor_availability_slots").insert({ mentor_id: mentorId, start_at: start, end_at: new Date(Date.parse(start) + HOUR).toISOString(), is_booked: true }).select("id").single();
    slotIds.push(slot!.id);
    const { data: session } = await admin
      .from("mentorship_sessions")
      .insert({ mentor_id: mentorId, mentee_id: menteeId, availability_slot_id: slot!.id, session_type: "mock_interview", scheduled_start: start, scheduled_end: new Date(Date.parse(start) + HOUR).toISOString(), price_ngn: PRICE, platform_commission_ngn: 3_750, mentor_payout_ngn: 21_250, status: "pending_payment" })
      .select("id")
      .single();
    sessionIds.push(session!.id);
    const reference = `mentor_session_${randomUUID()}`;
    const { data: txn } = await admin
      .from("payment_transactions")
      .insert({ user_id: menteeId, rail: "paystack", amount: PRICE, currency: "NGN", product_type: "mentor_session", product_id: session!.id, paystack_reference: reference, status: "pending" })
      .select("id")
      .single();
    transactionIds.push(txn!.id);
    verify.mockResolvedValue({ status: "success", reference, amount: PRICE * 100, currency: "NGN", channel: "card" });

    await fulfillPayment(reference);
    expect(await sessionStatus(session!.id)).toBe("awaiting_confirmation");
  });
});
