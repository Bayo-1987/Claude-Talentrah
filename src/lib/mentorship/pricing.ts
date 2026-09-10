/**
 * Pure pricing logic for a mentor session — the TS side of the SAME formula
 * `book_mentor_session` (0133) computes atomically in SQL. Duplicated on
 * purpose, not by oversight: the actual booking write has to happen inside
 * one atomic Postgres statement, which rules out calling out to this module
 * mid-transaction. tests/mentorship/commission-split.test.ts cross-checks a
 * real booked session's DB-computed values against what this module would
 * produce for the same inputs, specifically so the two cannot silently drift
 * without a test noticing. If you change a constant here, change 0133's copy
 * in the same commit.
 */

import type { Database } from "@/lib/supabase/types";

export type MentorshipSessionType = Database["public"]["Tables"]["mentorship_sessions"]["Row"]["session_type"];

/** §6.11's own flat rate for a 15-minute quick question, independent of the mentor's base tier. */
export const QUICK_QUESTION_PRICE_NGN = 6000;

/** §6.11's own +20–30% premium band for mock interviews / negotiation-for-a-specific-offer; 1.25 is the midpoint. */
export const PREMIUM_SESSION_MULTIPLIER = 1.25;

/** §6.11's own flat 15% platform commission. */
export const PLATFORM_COMMISSION_RATE = 0.15;

const PREMIUM_SESSION_TYPES: readonly MentorshipSessionType[] = ["mock_interview", "negotiation_strategy"];

/**
 * `basePriceNgn` is the mentor's own `mentor_profiles.base_price_ngn` —
 * `null` means a free/volunteer mentor (§6.11's own recommended v1 default),
 * which always prices every session type at 0 regardless of type, including
 * quick_question — there is no such thing as a paid "quick question" with a
 * free mentor.
 */
export function computeSessionPrice(
  basePriceNgn: number | null,
  sessionType: MentorshipSessionType,
): number {
  if (basePriceNgn === null) return 0;
  if (sessionType === "quick_question") return QUICK_QUESTION_PRICE_NGN;
  if (PREMIUM_SESSION_TYPES.includes(sessionType)) {
    return Math.round(basePriceNgn * PREMIUM_SESSION_MULTIPLIER);
  }
  return basePriceNgn;
}

export interface CommissionSplit {
  priceNgn: number;
  platformCommissionNgn: number;
  mentorPayoutNgn: number;
}

/**
 * Rounds the commission first and derives the payout as the remainder
 * (`price - commission`), never rounding both sides independently — that is
 * the only way to guarantee `commission + payout === price` always holds,
 * which is also why 0133 enforces it as a table CHECK rather than trusting
 * either side of the split to be computed correctly.
 */
export function computeCommissionSplit(priceNgn: number): CommissionSplit {
  const platformCommissionNgn = Math.round(priceNgn * PLATFORM_COMMISSION_RATE);
  return {
    priceNgn,
    platformCommissionNgn,
    mentorPayoutNgn: priceNgn - platformCommissionNgn,
  };
}

export function priceSession(
  basePriceNgn: number | null,
  sessionType: MentorshipSessionType,
): CommissionSplit {
  return computeCommissionSplit(computeSessionPrice(basePriceNgn, sessionType));
}

/**
 * §6.11's own researched pricing anchors, by mentor tier — display-only
 * (a mentor sets their own `base_price_ngn` directly; this is guidance shown
 * on the application form, not enforced). Explicitly NOT validated, same
 * caveat as every other price in this app.
 */
export const PRICING_TIER_ANCHORS_NGN = {
  entry: { min: 10_000, max: 15_000 },
  mid: { min: 20_000, max: 40_000 },
  senior: { min: 50_000, max: 100_000 },
} as const;
