/**
 * The 15%/85% commission split, tested directly rather than assumed from the
 * charge amount — send-137's own explicit requirement.
 *
 * Two layers, matching the two places this formula actually lives (0133's
 * own header explains why it is duplicated rather than shared):
 *  1. Pure unit tests of src/lib/mentorship/pricing.ts in isolation.
 *  2. A real DB cross-check: book a real session through `book_mentor_session`
 *     (0133) and assert its ACTUAL computed price/commission/payout match
 *     what the TS pure function would produce for the same inputs — proving
 *     the two sides have not silently drifted apart, rather than trusting
 *     either alone.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";
import {
  computeSessionPrice,
  computeCommissionSplit,
  priceSession,
  QUICK_QUESTION_PRICE_NGN,
  PREMIUM_SESSION_MULTIPLIER,
  PLATFORM_COMMISSION_RATE,
  type MentorshipSessionType,
} from "@/lib/mentorship/pricing";

describe("pricing.ts pure functions", () => {
  it("a free/volunteer mentor (null base price) always prices at 0, every session type", () => {
    const types: MentorshipSessionType[] = [
      "resume_review",
      "mock_interview",
      "career_strategy",
      "negotiation_strategy",
      "quick_question",
    ];
    for (const t of types) {
      expect(computeSessionPrice(null, t)).toBe(0);
    }
  });

  it("quick_question is a flat rate, independent of the mentor's base price", () => {
    expect(computeSessionPrice(10_000, "quick_question")).toBe(QUICK_QUESTION_PRICE_NGN);
    expect(computeSessionPrice(90_000, "quick_question")).toBe(QUICK_QUESTION_PRICE_NGN);
  });

  it("mock_interview and negotiation_strategy carry the premium multiplier", () => {
    expect(computeSessionPrice(20_000, "mock_interview")).toBe(Math.round(20_000 * PREMIUM_SESSION_MULTIPLIER));
    expect(computeSessionPrice(20_000, "negotiation_strategy")).toBe(
      Math.round(20_000 * PREMIUM_SESSION_MULTIPLIER),
    );
  });

  it("resume_review and career_strategy charge the mentor's base price unmodified", () => {
    expect(computeSessionPrice(15_000, "resume_review")).toBe(15_000);
    expect(computeSessionPrice(15_000, "career_strategy")).toBe(15_000);
  });

  it("commission + payout always sums to the full price, for many prices", () => {
    for (const price of [0, 1, 6_000, 10_000, 12_345, 99_999, 100_000]) {
      const split = computeCommissionSplit(price);
      expect(split.platformCommissionNgn + split.mentorPayoutNgn, `price=${price}`).toBe(price);
    }
  });

  it("the commission is exactly 15% of price, rounded", () => {
    const split = computeCommissionSplit(20_000);
    expect(split.platformCommissionNgn).toBe(Math.round(20_000 * PLATFORM_COMMISSION_RATE));
    expect(split.platformCommissionNgn).toBe(3_000);
    expect(split.mentorPayoutNgn).toBe(17_000);
  });

  it("an odd price still splits exactly, with no lost or duplicated naira", () => {
    // 12,345 * 0.15 = 1851.75 -> rounds to 1852, payout is the remainder.
    const split = computeCommissionSplit(12_345);
    expect(split.platformCommissionNgn).toBe(1_852);
    expect(split.mentorPayoutNgn).toBe(10_493);
    expect(split.platformCommissionNgn + split.mentorPayoutNgn).toBe(12_345);
  });

  it("priceSession composes computeSessionPrice and computeCommissionSplit correctly", () => {
    const result = priceSession(20_000, "mock_interview");
    const expectedPrice = Math.round(20_000 * PREMIUM_SESSION_MULTIPLIER);
    expect(result.priceNgn).toBe(expectedPrice);
    expect(result.platformCommissionNgn + result.mentorPayoutNgn).toBe(expectedPrice);
  });
});

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Commission-split DB cross-check cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

describe("book_mentor_session's SQL-computed split matches pricing.ts for the same inputs", () => {
  let mentorId: string;
  let menteeId: string;
  const BASE_PRICE = 24_000;

  beforeAll(async () => {
    const mentor = await createTestUser("commission-mentor");
    const mentee = await createTestUser("commission-mentee");
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

  async function bookAndReadBack(sessionType: MentorshipSessionType) {
    const { data: slot, error: slotError } = await admin
      .from("mentor_availability_slots")
      .insert({
        mentor_id: mentorId,
        start_at: new Date(Date.now() + 3600_000).toISOString(),
        end_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      })
      .select("id")
      .single();
    if (slotError || !slot) throw slotError ?? new Error("no slot");

    const { data: rows, error } = await admin.rpc("book_mentor_session", {
      p_availability_slot_id: slot.id,
      p_mentee_id: menteeId,
      p_session_type: sessionType,
    });
    if (error || !rows?.[0]) throw error ?? new Error("booking failed");

    const { data: session, error: readError } = await admin
      .from("mentorship_sessions")
      .select("price_ngn, platform_commission_ngn, mentor_payout_ngn")
      .eq("id", rows[0].session_id)
      .single();
    if (readError || !session) throw readError ?? new Error("session not found");
    return session;
  }

  const CASES: MentorshipSessionType[] = [
    "resume_review",
    "mock_interview",
    "negotiation_strategy",
    "quick_question",
    "career_strategy",
  ];

  for (const sessionType of CASES) {
    it(`${sessionType}: DB output equals pricing.ts's output for base price ₦${BASE_PRICE.toLocaleString()}`, async () => {
      const expected = priceSession(BASE_PRICE, sessionType);
      const actual = await bookAndReadBack(sessionType);

      expect(actual.price_ngn, "MONEY: SQL and TS pricing have drifted apart on price").toBe(expected.priceNgn);
      expect(
        actual.platform_commission_ngn,
        "MONEY: SQL and TS pricing have drifted apart on the platform commission",
      ).toBe(expected.platformCommissionNgn);
      expect(
        actual.mentor_payout_ngn,
        "MONEY: SQL and TS pricing have drifted apart on the mentor payout",
      ).toBe(expected.mentorPayoutNgn);
      expect(actual.platform_commission_ngn + actual.mentor_payout_ngn).toBe(actual.price_ngn);
    });
  }
});
