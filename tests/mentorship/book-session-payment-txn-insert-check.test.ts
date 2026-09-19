/**
 * send-379 — `bookMentorSessionAction`'s `payment_transactions` insert used
 * to be fire-and-forget: its `error` was never captured, so a failed insert
 * (a transient DB error, a dropped connection, a constraint violation) still
 * fell through into `initializeTransaction` and sent the mentee to a REAL
 * Paystack checkout for a transaction record that was never actually
 * written. `fulfillPayment` (both the webhook and the checkout callback)
 * confirms a charge by looking it up via `paystack_reference` — with no row
 * to find, a mentee who genuinely paid never leaves `pending_payment`, and
 * there is no `payment_transactions` row for support to trace the charge by.
 *
 * ── HOW THE INSERT FAILURE IS SIMULATED ────────────────────────────────────
 *
 * Not a stub of the whole Supabase client — a real, physical failure: two
 * bookings deliberately reuse the same `paystack_reference` (by pinning
 * `node:crypto`'s `randomUUID`), so the SECOND booking's own
 * `payment_transactions` insert hits the table's real
 * `payment_transactions_paystack_reference_key` UNIQUE constraint
 * (`supabase/migrations/0000_baseline_schema.sql`). This is a genuine
 * Postgres-level insert failure, not a mocked one — closer to the real
 * transient-DB-error class this bug protects against than a hand-rolled
 * client stub would be.
 *
 * `initializeTransaction` (a real Paystack API call) is mocked so the test
 * never actually talks to Paystack; what it proves is whether the action
 * reaches that call at all, which is exactly the question this bug is about.
 *
 * ── PROVING THE BUG, NOT JUST THE FIX ──────────────────────────────────────
 *
 * The first test in each pair below is written to PASS against the fixed
 * code and FAIL against the pre-fix code (verified manually by temporarily
 * reverting the `insertError` check in src/lib/mentorship/actions.ts and
 * re-running this file: the "never reaches initializeTransaction" assertion
 * failed exactly as expected, proving this test actually catches the bug
 * before trusting it to catch a regression of it).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID as realRandomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor, type DB } from "../support/auth";

const initializeTransaction = vi.fn();
vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, initializeTransaction, NGN_CHANNELS: actual.NGN_CHANNELS };
});

// Fixed to a known value so a second booking's payment_transactions insert
// collides with the first's paystack_reference — a real unique-constraint
// violation, not a mocked error.
const fixedUuid = vi.hoisted(() => ({ current: "" }));
vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return { ...actual, randomUUID: () => fixedUuid.current || actual.randomUUID() };
});

const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => testClientRef.current,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// getOrigin() calls next/headers' headers(), which needs a real request
// scope outside of which it throws — mocked the same way next/cache is,
// with a fixed host so authorizationUrl's callbackUrl is deterministic.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000" }),
}));

const { bookMentorSessionAction } = await import("@/lib/mentorship/actions");

function redirectDigest(err: unknown): string {
  const digest = (err as { digest?: string } | undefined)?.digest;
  if (!digest || !digest.startsWith("NEXT_REDIRECT")) {
    throw new Error(`expected a redirect, got: ${err instanceof Error ? err.stack : String(err)}`);
  }
  return digest;
}

function redirectUrl(err: unknown): string {
  return redirectDigest(err).split(";")[2];
}

const BASE_PRICE = 15_000;
let mentorId: string;
let menteeId: string;
const slotIds: string[] = [];
const sessionIds: string[] = [];
const references: string[] = [];

beforeAll(async () => {
  const mentor = await createTestUser("send379-mentor");
  const mentee = await createTestUser("send379-mentee");
  mentorId = mentor.id;
  menteeId = mentee.id;
  testClientRef.current = await sessionFor(mentee.email, mentee.id);

  const { error } = await admin
    .from("mentor_profiles")
    .insert({ user_id: mentorId, status: "approved", base_price_ngn: BASE_PRICE });
  if (error) throw error;
}, 60_000);

afterEach(() => {
  initializeTransaction.mockReset();
  fixedUuid.current = "";
});

afterAll(async () => {
  if (sessionIds.length) await admin.from("mentorship_sessions").delete().in("id", sessionIds);
  if (references.length) await admin.from("payment_transactions").delete().in("paystack_reference", references);
  if (slotIds.length) await admin.from("mentor_availability_slots").delete().in("id", slotIds);
  await admin.from("mentor_profiles").delete().eq("user_id", mentorId);
  await deleteTestUsers([mentorId, menteeId]);
}, 60_000);

/** A fresh, far-future availability slot — same 30-day-out convention as
 * tests/mentorship/payment-idempotency.test.ts, to stay outside the
 * no-show sweep's 24-hour window regardless of run order. */
async function freshSlot(offsetHours: number) {
  const start = new Date(Date.now() + 30 * 24 * 3600_000 + offsetHours * 3600_000);
  const end = new Date(start.getTime() + 3600_000);
  const { data, error } = await admin
    .from("mentor_availability_slots")
    .insert({ mentor_id: mentorId, start_at: start.toISOString(), end_at: end.toISOString() })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no slot");
  slotIds.push(data.id);
  return data.id;
}

async function paymentTxnCount(reference: string): Promise<number> {
  const { count } = await admin
    .from("payment_transactions")
    .select("id", { count: "exact", head: true })
    .eq("paystack_reference", reference);
  return count ?? 0;
}

describe("bookMentorSessionAction — the payment_transactions insert is checked before Paystack is ever contacted", () => {
  it("THE ACTUAL FIX: when the insert fails (real unique-constraint violation), the action redirects to an error state and NEVER calls initializeTransaction", async () => {
    initializeTransaction.mockResolvedValue({ authorization_url: "https://paystack.test/should-not-be-used" });

    // First booking claims a reference for real.
    const collidingReference = `mentor_session_${realRandomUUID()}`;
    const firstSlot = await freshSlot(1);
    fixedUuid.current = collidingReference.replace("mentor_session_", "");
    let firstError: unknown;
    try {
      await bookMentorSessionAction(firstSlot, "resume_review");
    } catch (err) {
      firstError = err;
    }
    redirectDigest(firstError); // just proves it succeeded through to Paystack
    references.push(collidingReference);
    expect(await paymentTxnCount(collidingReference)).toBe(1);
    initializeTransaction.mockClear();

    // Second, independent booking is forced to reuse the SAME reference —
    // its own payment_transactions insert hits the real unique constraint.
    const secondSlot = await freshSlot(2);
    let secondResult: unknown;
    let secondErr: unknown;
    try {
      secondResult = await bookMentorSessionAction(secondSlot, "resume_review");
    } catch (err) {
      secondErr = err;
    }

    const url = redirectUrl(secondErr ?? { digest: undefined });
    expect(url).toContain("/mentorship?error=");
    expect(decodeURIComponent(url)).toContain("Could not start checkout");

    expect(
      initializeTransaction,
      "MONEY BUG: a Paystack checkout was started for a payment_transactions row that was never written",
    ).not.toHaveBeenCalled();

    // Still exactly one payment_transactions row for the colliding reference
    // — the second booking's insert never landed.
    expect(await paymentTxnCount(collidingReference)).toBe(1);

    // The second session it just booked exists (book_mentor_session already
    // ran and locked the slot before the payment step) but stays at
    // pending_payment forever without a payment_transactions row of its
    // own — this is the "not asking for reconciliation tooling" case, just
    // confirming the session-level state isn't corrupted by the refusal.
    const { data: secondSessionRows } = await admin
      .from("mentorship_sessions")
      .select("id, status")
      .eq("availability_slot_id", secondSlot);
    expect(secondSessionRows).toHaveLength(1);
    sessionIds.push(secondSessionRows![0].id);
    expect(secondSessionRows![0].status).toBe("pending_payment");
    void secondResult;
  });

  it("the ordinary path — no collision — still reaches Paystack exactly as before", async () => {
    initializeTransaction.mockResolvedValue({ authorization_url: "https://paystack.test/checkout/abc" });
    const slot = await freshSlot(3);

    let err: unknown;
    try {
      await bookMentorSessionAction(slot, "resume_review");
    } catch (e) {
      err = e;
    }

    expect(redirectUrl(err)).toBe("https://paystack.test/checkout/abc");
    expect(initializeTransaction).toHaveBeenCalledTimes(1);

    const { data: rows } = await admin
      .from("mentorship_sessions")
      .select("id")
      .eq("availability_slot_id", slot)
      .single();
    sessionIds.push(rows!.id);
    const { data: txn } = await admin
      .from("payment_transactions")
      .select("paystack_reference")
      .eq("product_id", rows!.id)
      .single();
    references.push(txn!.paystack_reference!);
  });

  it("a free/volunteer mentor session (base_price_ngn null) never touches payment_transactions or Paystack at all", async () => {
    const { error: freeMentorError } = await admin
      .from("mentor_profiles")
      .update({ base_price_ngn: null })
      .eq("user_id", mentorId);
    if (freeMentorError) throw freeMentorError;

    const slot = await freshSlot(4);
    let err: unknown;
    try {
      await bookMentorSessionAction(slot, "resume_review");
    } catch (e) {
      err = e;
    }
    expect(redirectUrl(err)).toBe("/mentorship/sessions?booked=1");
    expect(initializeTransaction).not.toHaveBeenCalled();

    const { data: rows } = await admin
      .from("mentorship_sessions")
      .select("id")
      .eq("availability_slot_id", slot)
      .single();
    sessionIds.push(rows!.id);

    await admin.from("mentor_profiles").update({ base_price_ngn: BASE_PRICE }).eq("user_id", mentorId);
  });
});
