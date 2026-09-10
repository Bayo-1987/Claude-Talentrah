/**
 * Mentor payouts (0149) — the first OUTBOUND-money feature in this codebase,
 * held to the idempotency bar CLAUDE.md sets for anything gating on a
 * compared value: check-and-act in ONE database statement, never a
 * read-then-write. `claim_mentor_payout` and `attemptPayout`
 * (src/lib/mentorship/payouts.ts) are what this file proves, the same way
 * tests/talent-directory/subscription-idempotency.test.ts proves
 * fulfillPayment and tests/mentorship/no-show-sweep.test.ts proves the
 * refund sweep — real database, real rows, only Paystack itself mocked.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Payout idempotency test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const initiateTransfer = vi.hoisted(() => vi.fn());
const verifyTransfer = vi.hoisted(() => vi.fn());

vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, initiateTransfer, verifyTransfer };
});

let mentorId: string;
let menteeId: string;
const sessionIds: string[] = [];
const payoutIds: string[] = [];

beforeAll(async () => {
  const mentor = await createTestUser("payout-mentor");
  const mentee = await createTestUser("payout-mentee");
  mentorId = mentor.id;
  menteeId = mentee.id;
  const { error } = await admin.from("mentor_profiles").insert({
    user_id: mentorId,
    status: "approved",
    base_price_ngn: 15_000,
    payout_bank_code: "058",
    payout_account_number: "0123456789",
    payout_account_name: "Test Mentor",
    payout_recipient_code: "RCP_test_fixture",
    payout_bank_verified_at: new Date().toISOString(),
  });
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await admin.from("mentor_profiles").delete().eq("user_id", mentorId);
  await deleteTestUsers([mentorId, menteeId]);
}, 60_000);

beforeEach(() => {
  initiateTransfer.mockReset();
  verifyTransfer.mockReset();
});

afterEach(async () => {
  if (payoutIds.length) await admin.from("mentor_payouts").delete().in("id", payoutIds);
  if (sessionIds.length) await admin.from("mentorship_sessions").delete().in("id", sessionIds);
  payoutIds.length = 0;
  sessionIds.length = 0;
});

/** A COMPLETED, paid session — bypasses book_mentor_session so the fixture can set an arbitrary scheduled_end/status directly. */
async function makeCompletedSession(priceNgn: number) {
  const { data: slot, error: slotError } = await admin
    .from("mentor_availability_slots")
    .insert({
      mentor_id: mentorId,
      start_at: new Date(Date.now() - 5 * 24 * 3600_000).toISOString(),
      end_at: new Date(Date.now() - 5 * 24 * 3600_000 + 3600_000).toISOString(),
      is_booked: true,
    })
    .select("id")
    .single();
  if (slotError || !slot) throw slotError ?? new Error("no slot");

  const commission = Math.round(priceNgn * 0.15);
  const { data: session, error } = await admin
    .from("mentorship_sessions")
    .insert({
      mentor_id: mentorId,
      mentee_id: menteeId,
      availability_slot_id: slot.id,
      session_type: "resume_review",
      scheduled_start: new Date(Date.now() - 5 * 24 * 3600_000).toISOString(),
      scheduled_end: new Date(Date.now() - 5 * 24 * 3600_000 + 3600_000).toISOString(),
      price_ngn: priceNgn,
      platform_commission_ngn: commission,
      mentor_payout_ngn: priceNgn - commission,
      status: "completed",
    })
    .select("id, mentor_payout_ngn")
    .single();
  if (error || !session) throw error ?? new Error("no session");
  sessionIds.push(session.id);
  return session;
}

/** A payout row, already ELIGIBLE (past its hold window) — bypasses sync_mentor_payout_rows so the fixture doesn't have to wait 72 real hours. */
async function makeEligiblePayout(sessionId: string, amountNgn: number) {
  const { data: payout, error } = await admin
    .from("mentor_payouts")
    .insert({
      session_id: sessionId,
      mentor_id: mentorId,
      amount_ngn: amountNgn,
      eligible_at: new Date(Date.now() - 3600_000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !payout) throw error ?? new Error("no payout row");
  payoutIds.push(payout.id);
  return payout.id;
}

async function payoutRow(id: string) {
  const { data } = await admin
    .from("mentor_payouts")
    .select("status, attempt_count, pending_transfer_reference, paystack_transfer_code, failure_reason")
    .eq("id", id)
    .single();
  return data!;
}

describe("attemptPayout: claim_mentor_payout makes a single row's attempt idempotent under concurrency", () => {
  it("CONCURRENT attemptPayout calls on the SAME row: Paystack is charged exactly once", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);

    initiateTransfer.mockResolvedValue({
      transfer_code: "TRF_1",
      reference: "irrelevant-overridden-by-caller",
      amount: session.mentor_payout_ngn * 100,
      currency: "NGN",
      status: "success",
    });

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const [a, b] = await Promise.all([attemptPayout(payoutId), attemptPayout(payoutId)]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(
      outcomes,
      "MONEY BUG: two concurrent attempts both won the claim on the same payout row",
    ).toEqual(["not_eligible", "paid"]);
    expect(initiateTransfer, "MONEY BUG: Paystack was asked to transfer money twice for one session").toHaveBeenCalledTimes(1);

    const after = await payoutRow(payoutId);
    expect(after.status).toBe("paid");
  });

  it("a payout already PAID cannot be re-attempted by a manual retry", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);
    initiateTransfer.mockResolvedValue({
      transfer_code: "TRF_2",
      reference: "x",
      amount: session.mentor_payout_ngn * 100,
      currency: "NGN",
      status: "success",
    });

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const first = await attemptPayout(payoutId);
    expect(first.outcome).toBe("paid");

    const second = await attemptPayout(payoutId);
    expect(second.outcome, "MONEY BUG: a retry re-paid an already-paid session").toBe("not_eligible");
    expect(initiateTransfer, "MONEY BUG: a second transfer was requested for an already-paid session").toHaveBeenCalledTimes(1);
  });
});

describe("attemptPayout: a genuinely FAILED transfer is retryable without double-paying", () => {
  it("a declined transfer is marked failed, and a later retry with a FRESH reference can still succeed", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);

    const { PaystackDeclineError } = await import("@/lib/paystack/client");
    initiateTransfer.mockRejectedValueOnce(new PaystackDeclineError("Invalid recipient", 400));

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const first = await attemptPayout(payoutId);
    expect(first.outcome).toBe("failed");
    const afterFirst = await payoutRow(payoutId);
    expect(afterFirst.status).toBe("failed");
    expect(afterFirst.pending_transfer_reference, "a DECLINED attempt must not leave a reference to resume").toBeNull();

    initiateTransfer.mockResolvedValueOnce({
      transfer_code: "TRF_retry",
      reference: "x",
      amount: session.mentor_payout_ngn * 100,
      currency: "NGN",
      status: "success",
    });
    const second = await attemptPayout(payoutId);
    expect(second.outcome).toBe("paid");

    expect(initiateTransfer).toHaveBeenCalledTimes(2);
    const refs = initiateTransfer.mock.calls.map((c) => c[0].reference);
    expect(
      new Set(refs).size,
      "MONEY BUG: the retry reused the failed attempt's own reference instead of minting a fresh one",
    ).toBe(2);

    const after = await payoutRow(payoutId);
    expect(after.status).toBe("paid");
  });
});

describe("attemptPayout: an INDETERMINATE outcome is resolved, never blindly retried with a new charge", () => {
  it("a network failure keeps the row retryable, and the retry VERIFIES the same reference instead of transferring again", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);

    const { PaystackUnavailableError } = await import("@/lib/paystack/client");
    initiateTransfer.mockRejectedValueOnce(new PaystackUnavailableError("timed out"));

    const { attemptPayout } = await import("@/lib/mentorship/payouts");
    const first = await attemptPayout(payoutId);
    expect(first.outcome).toBe("indeterminate");

    const afterFirst = await payoutRow(payoutId);
    expect(afterFirst.status, "an indeterminate outcome must stay retryable, not become a terminal failure").toBe("pending");
    expect(afterFirst.pending_transfer_reference, "the outstanding reference must be retained so it can be resolved").not.toBeNull();
    const outstandingReference = afterFirst.pending_transfer_reference!;

    // The retry must VERIFY the same reference, never call initiateTransfer
    // again — Paystack may already have created that transfer.
    verifyTransfer.mockResolvedValueOnce({
      transfer_code: "TRF_resolved",
      reference: outstandingReference,
      amount: session.mentor_payout_ngn * 100,
      currency: "NGN",
      status: "success",
    });

    const second = await attemptPayout(payoutId);
    expect(second.outcome).toBe("paid");
    expect(verifyTransfer).toHaveBeenCalledWith(outstandingReference);
    expect(
      initiateTransfer,
      "MONEY BUG: an indeterminate outcome was resolved by transferring AGAIN instead of verifying the outstanding reference",
    ).toHaveBeenCalledTimes(1);

    const after = await payoutRow(payoutId);
    expect(after.status).toBe("paid");
    expect(after.paystack_transfer_code).toBe("TRF_resolved");
  });

  it("repeated indeterminate outcomes eventually need manual reconciliation, and the reference is KEPT, not discarded", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);

    const { PaystackUnavailableError } = await import("@/lib/paystack/client");
    initiateTransfer.mockRejectedValue(new PaystackUnavailableError("timed out"));
    verifyTransfer.mockRejectedValue(new PaystackUnavailableError("timed out"));

    const { attemptPayout, MAX_INDETERMINATE_PAYOUT_ATTEMPTS } = await import("@/lib/mentorship/payouts");

    let lastOutcome;
    for (let i = 0; i < MAX_INDETERMINATE_PAYOUT_ATTEMPTS + 1; i++) {
      lastOutcome = await attemptPayout(payoutId);
    }

    expect(lastOutcome!.outcome).toBe("failed");
    const after = await payoutRow(payoutId);
    expect(after.status).toBe("failed");
    expect(
      after.pending_transfer_reference,
      "MONEY BUG: the only thread back to a transfer of unknown outcome was discarded",
    ).not.toBeNull();
    expect(after.failure_reason).toMatch(/reconcil/i);
  });
});

describe("attemptPayout: the withheld-standing gate", () => {
  it("refuses to pay a mentor who is no longer approved, without ever calling Paystack", async () => {
    const session = await makeCompletedSession(15_000);
    const payoutId = await makeEligiblePayout(session.id, session.mentor_payout_ngn);

    await admin.from("mentor_profiles").update({ status: "suspended" }).eq("user_id", mentorId);
    try {
      const { attemptPayout } = await import("@/lib/mentorship/payouts");
      const outcome = await attemptPayout(payoutId);
      expect(outcome.outcome).toBe("failed");
      expect(initiateTransfer, "a suspended mentor's payout must never reach Paystack").not.toHaveBeenCalled();

      const after = await payoutRow(payoutId);
      expect(after.status).toBe("failed");
      expect(after.failure_reason).toMatch(/not currently approved/i);
    } finally {
      await admin.from("mentor_profiles").update({ status: "approved" }).eq("user_id", mentorId);
    }
  });
});
