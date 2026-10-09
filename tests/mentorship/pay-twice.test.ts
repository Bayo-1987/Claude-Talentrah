/**
 * A mentor session paid twice (audit 9 Oct, "mentor session payment").
 *
 * payForMentorSessionAction minted a NEW Paystack reference on every click for the same `pending_payment` booking. If the buyer paid a second reference after the first (an impatient re-click while a
 * bank transfer was still settling), the first payment moved the session to awaiting_confirmation, and the second landed on a session that was neither pending nor lapsed: settle_late_mentor_payment
 * answered `not_late`, fulfilment did nothing and then marked the SECOND payment `success`. Charged twice for one session, silently, never refunded (and the refund sweep's one-row lookup would choke on two).
 *
 * Two layers now:
 *   1. Fulfilment: a successful payment for a session that another successful payment already settled is marked `needs_refund` (the existing status, counted on Finance) and the operator is alerted.
 *      It never reaches `success`, and the session is untouched.
 *   2. Starting a checkout: before minting a new reference, an earlier open reference for the same booking is looked at. Paid -> it is fulfilled and the buyer is told so; still in flight at Paystack
 *      -> no second checkout; Paystack cannot be asked -> no second checkout (fail closed); abandoned or failed -> a new one is fine.
 * Real rows, grant functions and fulfilment; only Paystack's client, the operator mail and the signed-in session are faked.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../support/auth";

const initializeTransaction = vi.hoisted(() => vi.fn());
const verifyTransaction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, initializeTransaction, verifyTransaction, NGN_CHANNELS: actual.NGN_CHANNELS };
});
const alertMail = vi.hoisted(() => ({ sent: [] as Array<{ subject: string; text: string }> }));
vi.mock("@/lib/admin/alert-email", () => ({ sendAdminAlert: async (m: { subject: string; text: string }) => { alertMail.sent.push(m); return { sent: true as const }; } }));
vi.mock("@/lib/resend/client", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/resend/client")>()), getResendClient: () => null }));
const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => testClientRef.current }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));

import { fulfillPayment } from "@/lib/billing/fulfill";
const actions = (await import("@/lib/mentorship/actions")) as unknown as Record<string, ((id: string) => Promise<void>) | undefined>;

function redirectUrl(err: unknown): string {
  const digest = (err as { digest?: string } | undefined)?.digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) throw new Error(`expected a redirect, got: ${err instanceof Error ? err.stack : String(err)}`);
  return digest.split(";")[2];
}
async function pay(sessionId: string): Promise<string> {
  try {
    await actions.payForMentorSessionAction!(sessionId);
  } catch (err) {
    return redirectUrl(err);
  }
  throw new Error("payForMentorSessionAction should have redirected");
}

const HOUR = 3_600_000;
const PRICE = 25_000;
let mentorId = "";
let menteeId = "";
let menteeClient: DB;
const sessionIds: string[] = [];
const slotIds: string[] = [];

beforeAll(async () => {
  const [mentor, mentee] = await Promise.all([createTestUser("paytwice-mentor"), createTestUser("paytwice-mentee")]);
  mentorId = mentor.id;
  menteeId = mentee.id;
  menteeClient = await sessionFor(mentee.email, mentee.id);
  testClientRef.current = menteeClient;
  const { error } = await admin.from("mentor_profiles").upsert({ user_id: mentorId, status: "approved", base_price_ngn: 20_000 });
  if (error) throw error;
}, 60_000);

beforeEach(() => {
  initializeTransaction.mockReset();
  verifyTransaction.mockReset();
  alertMail.sent.length = 0;
  initializeTransaction.mockResolvedValue({ authorization_url: "https://paystack.test/pay/new", reference: "x", access_code: "y" });
});

afterEach(async () => {
  await admin.from("payment_transactions").delete().eq("user_id", menteeId);
  if (sessionIds.length) await admin.from("mentorship_sessions").delete().in("id", sessionIds.splice(0));
  if (slotIds.length) await admin.from("mentor_availability_slots").delete().in("id", slotIds.splice(0));
});

afterAll(async () => {
  await admin.from("mentor_profiles").delete().eq("user_id", mentorId);
  await deleteTestUsers([mentorId, menteeId]);
}, 60_000);

async function makeBooking(status = "pending_payment", slotBooked = true) {
  const start = new Date(Date.now() + 24 * HOUR).toISOString();
  const { data: slot, error: slotError } = await admin
    .from("mentor_availability_slots")
    .insert({ mentor_id: mentorId, start_at: start, end_at: new Date(Date.parse(start) + HOUR).toISOString(), is_booked: slotBooked })
    .select("id")
    .single();
  if (slotError || !slot) throw slotError ?? new Error("no slot");
  slotIds.push(slot.id);
  const { data: session, error } = await admin
    .from("mentorship_sessions")
    .insert({ mentor_id: mentorId, mentee_id: menteeId, availability_slot_id: slot.id, session_type: "mock_interview", scheduled_start: start, scheduled_end: new Date(Date.parse(start) + HOUR).toISOString(), price_ngn: PRICE, platform_commission_ngn: 3_750, mentor_payout_ngn: 21_250, status })
    .select("id")
    .single();
  if (error || !session) throw error ?? new Error("no session");
  sessionIds.push(session.id);
  return session.id;
}
async function makePayment(sessionId: string, status: "pending" | "success" = "pending") {
  const reference = `mentor_session_${randomUUID()}`;
  const { data, error } = await admin
    .from("payment_transactions")
    .insert({ user_id: menteeId, rail: "paystack", amount: PRICE, currency: "NGN", product_type: "mentor_session", product_id: sessionId, paystack_reference: reference, status })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no payment");
  return { id: data.id, reference };
}
/** Paystack's answer per reference; an unlisted reference answers "abandoned". */
function paystackSays(map: Record<string, string | Error>) {
  verifyTransaction.mockImplementation(async (ref: string) => {
    const a = map[ref] ?? "abandoned";
    if (a instanceof Error) throw a;
    return { status: a, reference: ref, amount: PRICE * 100, currency: "NGN", channel: "bank_transfer", authorization: null };
  });
}
const sessionStatus = async (id: string) => (await admin.from("mentorship_sessions").select("status").eq("id", id).single()).data!.status;
const paymentStatus = async (id: string) => (await admin.from("payment_transactions").select("status").eq("id", id).single()).data!.status;
const paymentCount = async (sessionId: string) => (await admin.from("payment_transactions").select("id", { count: "exact", head: true }).eq("product_type", "mentor_session").eq("product_id", sessionId)).count ?? 0;

describe("fulfilment: a normal single payment still works", () => {
  it("moves the session to awaiting_confirmation, marks the payment paid, raises no alert; a repeat delivery changes nothing", async () => {
    const sessionId = await makeBooking();
    const p = await makePayment(sessionId);
    paystackSays({ [p.reference]: "success" });
    expect((await fulfillPayment(p.reference)).status).toBe("success");
    expect(await sessionStatus(sessionId)).toBe("awaiting_confirmation");
    expect(await paymentStatus(p.id)).toBe("success");
    expect((await fulfillPayment(p.reference)).status).toBe("already_processed");
    expect(alertMail.sent).toHaveLength(0);
  });

  it("the webhook and the callback page racing on ONE reference: one success, never flagged as a duplicate, no alert", async () => {
    const sessionId = await makeBooking();
    const p = await makePayment(sessionId);
    paystackSays({ [p.reference]: "success" });
    const results = await Promise.all([fulfillPayment(p.reference), fulfillPayment(p.reference)]);
    expect(results.map((r) => r.status)).not.toContain("needs_refund");
    expect(await paymentStatus(p.id)).toBe("success");
    expect(await sessionStatus(sessionId)).toBe("awaiting_confirmation");
    expect(alertMail.sent).toHaveLength(0);
  });

  it("a payment that arrives late for a lapsed booking whose slot is still free is still reinstated (unchanged)", async () => {
    const sessionId = await makeBooking("expired_unpaid", false);
    const p = await makePayment(sessionId);
    paystackSays({ [p.reference]: "success" });
    expect((await fulfillPayment(p.reference)).status).toBe("success");
    expect(await sessionStatus(sessionId)).toBe("awaiting_confirmation");
    expect(await paymentStatus(p.id)).toBe("success");
  });
});

describe("fulfilment: a second payment for an already-paid session", () => {
  it("is marked needs_refund, never success; the session is untouched; the operator is told which reference", async () => {
    const sessionId = await makeBooking();
    const first = await makePayment(sessionId);
    const second = await makePayment(sessionId);
    paystackSays({ [first.reference]: "success", [second.reference]: "success" });
    expect((await fulfillPayment(first.reference)).status).toBe("success");

    const result = await fulfillPayment(second.reference);
    expect(result.status, "MONEY: a second payment for a paid session was accepted as success").toBe("needs_refund");
    expect(await paymentStatus(second.id)).toBe("needs_refund");
    expect(await paymentStatus(first.id)).toBe("success");
    expect(await sessionStatus(sessionId)).toBe("awaiting_confirmation");
    expect(alertMail.sent).toHaveLength(1);
    expect(alertMail.sent[0].text).toContain(second.reference);
    expect(alertMail.sent[0].text).not.toContain(first.reference);
  });

  it("a redelivery of the flagged payment does not alert again", async () => {
    const sessionId = await makeBooking();
    const first = await makePayment(sessionId);
    const second = await makePayment(sessionId);
    paystackSays({ [first.reference]: "success", [second.reference]: "success" });
    await fulfillPayment(first.reference);
    await fulfillPayment(second.reference);
    alertMail.sent.length = 0;
    expect((await fulfillPayment(second.reference)).status).toBe("already_processed");
    expect(alertMail.sent).toHaveLength(0);
  });
});

describe("starting a checkout for a booking that already has an open reference", () => {
  it("an earlier reference still in flight at Paystack: no second checkout is started", async () => {
    const sessionId = await makeBooking();
    const earlier = await makePayment(sessionId);
    paystackSays({ [earlier.reference]: "pending" });
    const url = await pay(sessionId);
    expect(url).toMatch(/^\/mentorship\/sessions\?error=/);
    expect(decodeURIComponent(url)).toMatch(/already in progress/i);
    expect(initializeTransaction).not.toHaveBeenCalled();
    expect(await paymentCount(sessionId)).toBe(1);
  });

  it("an earlier reference that Paystack says is PAID (the webhook never arrived): it is fulfilled, the buyer is told it is booked, and no second checkout is started", async () => {
    const sessionId = await makeBooking();
    const earlier = await makePayment(sessionId);
    paystackSays({ [earlier.reference]: "success" });
    const url = await pay(sessionId);
    expect(url).toBe("/mentorship/sessions?booked=1");
    expect(initializeTransaction).not.toHaveBeenCalled();
    expect(await paymentStatus(earlier.id)).toBe("success");
    expect(await sessionStatus(sessionId)).toBe("awaiting_confirmation");
    expect(await paymentCount(sessionId)).toBe(1);
  });

  it("Paystack cannot be asked about the earlier reference: no second checkout (fail closed)", async () => {
    const sessionId = await makeBooking();
    await makePayment(sessionId);
    verifyTransaction.mockRejectedValue(new Error("timeout"));
    const url = await pay(sessionId);
    expect(url).toMatch(/^\/mentorship\/sessions\?error=/);
    expect(initializeTransaction).not.toHaveBeenCalled();
    expect(await paymentCount(sessionId)).toBe(1);
  });

  it("an earlier reference that was only abandoned does not block a new checkout", async () => {
    const sessionId = await makeBooking();
    const earlier = await makePayment(sessionId);
    paystackSays({ [earlier.reference]: "abandoned" });
    expect(await pay(sessionId)).toBe("https://paystack.test/pay/new");
    expect(initializeTransaction).toHaveBeenCalledTimes(1);
    expect(await paymentCount(sessionId)).toBe(2);
  });

  it("a booking with no earlier payment starts a checkout without asking Paystack anything", async () => {
    const sessionId = await makeBooking();
    expect(await pay(sessionId)).toBe("https://paystack.test/pay/new");
    expect(verifyTransaction).not.toHaveBeenCalled();
    expect(await paymentCount(sessionId)).toBe(1);
  });
});
