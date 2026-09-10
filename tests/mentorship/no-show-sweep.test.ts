/**
 * The no-show / cancellation policy, actually enforced — send-137's own
 * explicit requirement, not just documented in 0133's header comment.
 *
 * `runMentorshipSweep` (src/lib/mentorship/sweep.ts) runs for real against
 * the database; `refundTransaction` is mocked, the same reasoning as every
 * other Paystack-calling test here — there is no way to make the real API
 * confirm a controlled refund.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`No-show sweep test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const refund = vi.hoisted(() => vi.fn());

vi.mock("@/lib/paystack/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/paystack/client")>("@/lib/paystack/client");
  return { ...actual, refundTransaction: refund };
});

let mentorId: string;
let menteeId: string;
const sessionIds: string[] = [];
const transactionIds: string[] = [];

beforeAll(async () => {
  const mentor = await createTestUser("sweep-mentor");
  const mentee = await createTestUser("sweep-mentee");
  mentorId = mentor.id;
  menteeId = mentee.id;
  const { error } = await admin.from("mentor_profiles").insert({
    user_id: mentorId,
    status: "approved",
    base_price_ngn: 15_000,
  });
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await admin.from("mentor_profiles").delete().eq("user_id", mentorId);
  await deleteTestUsers([mentorId, menteeId]);
}, 60_000);

afterEach(async () => {
  refund.mockReset();
  if (sessionIds.length) await admin.from("mentorship_sessions").delete().in("id", sessionIds);
  if (transactionIds.length) await admin.from("payment_transactions").delete().in("id", transactionIds);
  sessionIds.length = 0;
  transactionIds.length = 0;
});

/** A session in `awaiting_confirmation`, scheduled to start `hoursFromNow` from now — bypasses book_mentor_session so the fixture can set an arbitrary scheduled_start. */
async function makeAwaitingConfirmationSession(hoursFromNow: number, priceNgn: number) {
  const { data: slot, error: slotError } = await admin
    .from("mentor_availability_slots")
    .insert({
      mentor_id: mentorId,
      start_at: new Date(Date.now() + hoursFromNow * 3600_000).toISOString(),
      end_at: new Date(Date.now() + (hoursFromNow + 1) * 3600_000).toISOString(),
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
      scheduled_start: new Date(Date.now() + hoursFromNow * 3600_000).toISOString(),
      scheduled_end: new Date(Date.now() + (hoursFromNow + 1) * 3600_000).toISOString(),
      price_ngn: priceNgn,
      platform_commission_ngn: commission,
      mentor_payout_ngn: priceNgn - commission,
      status: "awaiting_confirmation",
    })
    .select("id")
    .single();
  if (error || !session) throw error ?? new Error("no session");
  sessionIds.push(session.id);

  if (priceNgn > 0) {
    const reference = `mentor_session_${randomUUID()}`;
    const { data: txn, error: txnError } = await admin
      .from("payment_transactions")
      .insert({
        user_id: menteeId,
        rail: "paystack",
        amount: priceNgn,
        currency: "NGN",
        product_type: "mentor_session",
        product_id: session.id,
        paystack_reference: reference,
        status: "success",
      })
      .select("id")
      .single();
    if (txnError || !txn) throw txnError ?? new Error("no transaction");
    transactionIds.push(txn.id);
  }

  return session.id;
}

describe("runMentorshipSweep enforces the 24-hour no-show/cancellation policy", () => {
  it("a PAID session overdue for confirmation is cancelled AND refunded", async () => {
    const sessionId = await makeAwaitingConfirmationSession(2, 15_000); // starts in 2h, inside the 24h deadline
    refund.mockResolvedValue({ status: "success", amount: 1_500_000, currency: "NGN" });

    const { runMentorshipSweep } = await import("@/lib/mentorship/sweep");
    const summary = await runMentorshipSweep();

    expect(summary.ok).toBe(true);
    expect(summary.cancelled).toBeGreaterThanOrEqual(1);
    expect(summary.refunded).toBeGreaterThanOrEqual(1);
    expect(refund).toHaveBeenCalledWith(expect.stringContaining("mentor_session_"));

    const { data } = await admin.from("mentorship_sessions").select("status").eq("id", sessionId).single();
    expect(data?.status, "the no-show policy did not actually cancel and refund the session").toBe("refunded");
  });

  it("a FREE session overdue for confirmation is cancelled, with NO refund attempt", async () => {
    const sessionId = await makeAwaitingConfirmationSession(2, 0);

    const { runMentorshipSweep } = await import("@/lib/mentorship/sweep");
    await runMentorshipSweep();

    expect(refund, "a free session must never trigger a refund call").not.toHaveBeenCalled();
    const { data } = await admin.from("mentorship_sessions").select("status").eq("id", sessionId).single();
    expect(data?.status).toBe("cancelled_mentor_no_confirm");
  });

  it("a session still well outside the 24-hour deadline is left untouched", async () => {
    const sessionId = await makeAwaitingConfirmationSession(72, 15_000); // starts in 3 days
    refund.mockResolvedValue({ status: "success", amount: 1_500_000, currency: "NGN" });

    const { runMentorshipSweep } = await import("@/lib/mentorship/sweep");
    await runMentorshipSweep();

    expect(refund).not.toHaveBeenCalled();
    const { data } = await admin.from("mentorship_sessions").select("status").eq("id", sessionId).single();
    expect(
      data?.status,
      "the sweep cancelled a session that was not yet due — it should only act inside the 24h window",
    ).toBe("awaiting_confirmation");
  });

  it("a session the mentor already confirmed is never touched, even if it's inside the window", async () => {
    const sessionId = await makeAwaitingConfirmationSession(2, 15_000);
    await admin.from("mentorship_sessions").update({ status: "confirmed" }).eq("id", sessionId);

    const { runMentorshipSweep } = await import("@/lib/mentorship/sweep");
    await runMentorshipSweep();

    expect(refund).not.toHaveBeenCalled();
    const { data } = await admin.from("mentorship_sessions").select("status").eq("id", sessionId).single();
    expect(data?.status).toBe("confirmed");
  });

  it("a refund request that FAILS leaves the session cancelled but NOT marked refunded — an honest, reconcilable state", async () => {
    const sessionId = await makeAwaitingConfirmationSession(2, 15_000);
    refund.mockRejectedValue(new Error("Paystack unavailable"));

    const { runMentorshipSweep } = await import("@/lib/mentorship/sweep");
    const summary = await runMentorshipSweep();

    expect(summary.refundFailed).toBeGreaterThanOrEqual(1);
    const { data } = await admin.from("mentorship_sessions").select("status").eq("id", sessionId).single();
    expect(
      data?.status,
      "a session must never be marked refunded when the refund request itself failed",
    ).toBe("cancelled_mentor_no_confirm");
  });

  it("running the sweep TWICE never double-cancels or double-refunds the same session", async () => {
    const sessionId = await makeAwaitingConfirmationSession(2, 15_000);
    refund.mockResolvedValue({ status: "success", amount: 1_500_000, currency: "NGN" });

    const { runMentorshipSweep } = await import("@/lib/mentorship/sweep");
    await runMentorshipSweep();
    await runMentorshipSweep();

    expect(refund, "MONEY BUG: a second sweep run refunded the same session again").toHaveBeenCalledTimes(1);
    const { data } = await admin.from("mentorship_sessions").select("status").eq("id", sessionId).single();
    expect(data?.status).toBe("refunded");
  });
});
