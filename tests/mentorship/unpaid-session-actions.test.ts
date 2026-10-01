/**
 * send-502 / S15 — Pay and Cancel on an existing unpaid booking.
 *
 * `payForMentorSessionAction(sessionId)`: sends the mentee to Paystack for a booking they already made. The amount comes from
 * the session ROW (server-computed at booking), never from the client; the session must be the caller's, still
 * `pending_payment`, and its slot still ahead. `cancelUnpaidMentorSessionAction(sessionId)`: cancels the caller's own unpaid
 * booking through the atomic cancel_unpaid_mentor_session (the slot is released in the same statement).
 *
 * Same real-database pattern as book-session-payment-txn-insert-check.test.ts: the mentee's own session client, the
 * service-role client the action creates, only Paystack's initializeTransaction mocked.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../support/auth";

const initializeTransaction = vi.fn();
vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, initializeTransaction, NGN_CHANNELS: actual.NGN_CHANNELS };
});
const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => testClientRef.current }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));

const actions = (await import("@/lib/mentorship/actions")) as unknown as Record<string, ((id: string) => Promise<void>) | undefined>;

function redirectUrl(err: unknown): string {
  const digest = (err as { digest?: string } | undefined)?.digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) throw new Error(`expected a redirect, got: ${err instanceof Error ? err.stack : String(err)}`);
  return digest.split(";")[2];
}

async function run(name: "payForMentorSessionAction" | "cancelUnpaidMentorSessionAction", sessionId: string): Promise<string> {
  const action = actions[name];
  expect(action, `${name} must be exported from src/lib/mentorship/actions.ts`).toBeTypeOf("function");
  try {
    await action!(sessionId);
  } catch (err) {
    return redirectUrl(err);
  }
  throw new Error(`${name} should have redirected`);
}

const HOUR = 3_600_000;
const PRICE = 25_000;
let mentorId: string;
let menteeId: string;
let strangerId: string;
let strangerClient: DB;
let menteeClient: DB;
const sessionIds: string[] = [];
const slotIds: string[] = [];

beforeAll(async () => {
  const [mentor, mentee, stranger] = await Promise.all([createTestUser("unpaidact-mentor"), createTestUser("unpaidact-mentee"), createTestUser("unpaidact-stranger")]);
  mentorId = mentor.id;
  menteeId = mentee.id;
  strangerId = stranger.id;
  menteeClient = await sessionFor(mentee.email, mentee.id);
  testClientRef.current = menteeClient;
  strangerClient = await sessionFor(stranger.email, stranger.id);
  const { error } = await admin.from("mentor_profiles").upsert({ user_id: mentorId, status: "approved", base_price_ngn: 20_000 });
  if (error) throw error;
}, 60_000);

afterEach(async () => {
  initializeTransaction.mockReset();
  testClientRef.current = menteeClient;
  await admin.from("payment_transactions").delete().eq("user_id", menteeId);
  if (sessionIds.length) await admin.from("mentorship_sessions").delete().in("id", sessionIds.splice(0));
  if (slotIds.length) await admin.from("mentor_availability_slots").delete().in("id", slotIds.splice(0));
});

afterAll(async () => {
  await admin.from("mentor_profiles").delete().eq("user_id", mentorId);
  await deleteTestUsers([mentorId, menteeId, strangerId]);
}, 60_000);

async function makeBooking(startOffsetHours: number, status = "pending_payment") {
  const start = new Date(Date.now() + startOffsetHours * HOUR).toISOString();
  const { data: slot, error: slotError } = await admin
    .from("mentor_availability_slots")
    .insert({ mentor_id: mentorId, start_at: start, end_at: new Date(Date.parse(start) + HOUR).toISOString(), is_booked: true })
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
  return { sessionId: session.id, slotId: slot.id };
}

const txnCount = async () => (await admin.from("payment_transactions").select("id", { count: "exact", head: true }).eq("user_id", menteeId).eq("product_type", "mentor_session")).count ?? 0;

describe("payForMentorSessionAction", () => {
  it("sends the mentee to Paystack for their own unpaid booking, charging the booking's own price", async () => {
    const { sessionId } = await makeBooking(24);
    initializeTransaction.mockResolvedValue({ authorization_url: "https://paystack.test/pay/abc", reference: "x", access_code: "y" });

    const url = await run("payForMentorSessionAction", sessionId);
    expect(url).toBe("https://paystack.test/pay/abc");
    expect(initializeTransaction).toHaveBeenCalledTimes(1);
    expect(initializeTransaction.mock.calls[0][0]).toMatchObject({ amountNgn: PRICE, callbackUrl: "http://localhost:3000/mentorship/book/callback" });

    const { data } = await admin.from("payment_transactions").select("amount, status, product_type, product_id, user_id").eq("product_id", sessionId);
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ amount: PRICE, status: "pending", product_type: "mentor_session", user_id: menteeId });
  });

  it("refuses someone else's booking: no transaction, no Paystack call, an explained redirect", async () => {
    const { sessionId } = await makeBooking(24);
    testClientRef.current = strangerClient;
    const url = await run("payForMentorSessionAction", sessionId);
    expect(url).toMatch(/^\/mentorship\/sessions\?error=/);
    expect(initializeTransaction).not.toHaveBeenCalled();
    expect(await txnCount()).toBe(0);
    void strangerId;
  });

  it("refuses a booking that is no longer pending_payment (paid, expired, cancelled)", async () => {
    for (const status of ["awaiting_confirmation", "confirmed", "expired_unpaid", "cancelled_by_mentee"]) {
      const { sessionId } = await makeBooking(24, status);
      const url = await run("payForMentorSessionAction", sessionId);
      expect(url, status).toMatch(/^\/mentorship\/sessions\?error=/);
    }
    expect(initializeTransaction).not.toHaveBeenCalled();
    expect(await txnCount()).toBe(0);
  });

  it("refuses a booking whose slot has already started, even though the sweep has not run yet", async () => {
    const { sessionId } = await makeBooking(-2);
    const url = await run("payForMentorSessionAction", sessionId);
    expect(url).toMatch(/^\/mentorship\/sessions\?error=/);
    expect(initializeTransaction).not.toHaveBeenCalled();
    expect(await txnCount()).toBe(0);
  });

  it("refuses to start a NEW checkout once the 30-minute hold has lapsed (31 min in), and still allows one at 29 min in", async () => {
    const lapsed = await makeBooking(24);
    await admin.from("mentorship_sessions").update({ created_at: new Date(Date.now() - 31 * 60_000).toISOString() }).eq("id", lapsed.sessionId);
    const url = await run("payForMentorSessionAction", lapsed.sessionId);
    expect(url).toMatch(/^\/mentorship\/sessions\?error=.*30-minute/);
    expect(initializeTransaction).not.toHaveBeenCalled();
    expect(await txnCount()).toBe(0);

    const held = await makeBooking(24);
    await admin.from("mentorship_sessions").update({ created_at: new Date(Date.now() - 29 * 60_000).toISOString() }).eq("id", held.sessionId);
    initializeTransaction.mockResolvedValue({ authorization_url: "https://paystack.test/pay/held", reference: "x", access_code: "y" });
    expect(await run("payForMentorSessionAction", held.sessionId)).toBe("https://paystack.test/pay/held");
  });

  it("when Paystack is unavailable it marks the new transaction failed and explains, instead of leaving a pending ghost", async () => {
    const { sessionId } = await makeBooking(24);
    initializeTransaction.mockRejectedValue(new Error("down"));
    const url = await run("payForMentorSessionAction", sessionId);
    expect(url).toMatch(/^\/mentorship\/sessions\?error=/);
    const { data } = await admin.from("payment_transactions").select("status").eq("product_id", sessionId);
    expect(data?.map((r) => r.status)).toEqual(["failed"]);
  });
});

describe("cancelUnpaidMentorSessionAction", () => {
  it("cancels the mentee's own unpaid booking and releases its slot, then returns to the sessions page", async () => {
    const { sessionId, slotId } = await makeBooking(24);
    const url = await run("cancelUnpaidMentorSessionAction", sessionId);
    expect(url).toMatch(/^\/mentorship\/sessions(\?|$)/);
    expect(url).not.toMatch(/error=/);
    expect((await admin.from("mentorship_sessions").select("status").eq("id", sessionId).single()).data?.status).toBe("cancelled_by_mentee");
    expect((await admin.from("mentor_availability_slots").select("is_booked").eq("id", slotId).single()).data?.is_booked).toBe(false);
  });

  it("cannot cancel someone else's booking: it is untouched and the redirect explains", async () => {
    const { sessionId, slotId } = await makeBooking(24);
    testClientRef.current = strangerClient;
    const url = await run("cancelUnpaidMentorSessionAction", sessionId);
    expect(url).toMatch(/error=/);
    expect((await admin.from("mentorship_sessions").select("status").eq("id", sessionId).single()).data?.status).toBe("pending_payment");
    expect((await admin.from("mentor_availability_slots").select("is_booked").eq("id", slotId).single()).data?.is_booked).toBe(true);
  });

  it("cannot cancel a booking that has been paid for", async () => {
    const { sessionId } = await makeBooking(24, "awaiting_confirmation");
    const url = await run("cancelUnpaidMentorSessionAction", sessionId);
    expect(url).toMatch(/error=/);
    expect((await admin.from("mentorship_sessions").select("status").eq("id", sessionId).single()).data?.status).toBe("awaiting_confirmation");
  });
});
