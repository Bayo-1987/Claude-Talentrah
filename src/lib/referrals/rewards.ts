import { CREDIT_COSTS } from "@/lib/credits/costs";

/**
 * What a referral is worth, and the rule it is paid under.
 *
 * SINCE 0215 (decided 2026-10-02): a friend's SIGNUP pays NOTHING; ACTIVATION pays the WHOLE reward. The total per activated referral is
 * unchanged (50 credits, which used to be paid as 10 at signup and 40 at activation), so an honest referrer is no worse off, and the part
 * that was gameable (credits for a bare signup, no activity needed) is gone.
 *
 * A referral made BEFORE 0215 was already paid its 10-credit signup half. At activation it receives the remainder, so every referral
 * ends at the same total: no double payment, no clawback (see 0215's header).
 *
 * WHY THIS FILE EXISTS (0092, still true). The reward is granted from inside Postgres triggers (handle_new_user,
 * check_and_activate_referral), which have no TypeScript call site to read CREDIT_COSTS from. 0089's pricing rebase moved
 * CREDIT_COSTS.tailoringRun 5 -> 20 and silently left the referral amounts behind, so a referral lost three quarters of its value with
 * nothing to catch it. THE NUMBER IN 0215 (`50`) MUST EQUAL REFERRAL_REWARD_CREDITS: Postgres cannot import a constant, so
 * tests/referrals/referrals.test.ts reads the amount the live trigger really grants and compares it to this one, and every page and the
 * email derive their wording from here (tests/referrals/referral-copy.test.ts), so the copy cannot disagree with the database.
 */

/** The whole reward for one activated referral, paid at activation. Equal to 0215's literal. */
export const REFERRAL_REWARD_CREDITS = 50;

/** What a bare signup pays since 0215. */
export const REFERRAL_SIGNUP_BONUS_CREDITS = 0;

/**
 * What a signup paid BEFORE 0215. Kept because referrals made under the old rule have that amount in `reward_credits_referrer` and in the
 * ledger, and the tests that stand in for such a referral need the number; it is never paid any more.
 */
export const LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS = 10;

/**
 * The cap: this many referrals are rewarded per referrer in any rolling window of this many days (grant_referral_reward /
 * count_rewarded_referrals_last_30d). The unit is REFERRALS, not credits, and the window rolls: it is not a calendar month.
 */
export const REFERRAL_CAP = { referrals: 10, windowDays: 30 } as const;

/** How many resume tailorings the whole reward buys at the current price. Derived, never typed into copy. */
export function referralRewardTailorings(): number {
  return Math.floor(REFERRAL_REWARD_CREDITS / CREDIT_COSTS.tailoringRun);
}
