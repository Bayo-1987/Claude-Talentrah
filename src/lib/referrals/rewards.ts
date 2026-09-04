import { CREDIT_COSTS } from "@/lib/credits/costs";

/**
 * What a referral is actually worth, expressed in the action it buys rather
 * than a bare credit count.
 *
 * WHY THIS FILE EXISTS. 0089's pricing rebase (2026-09-03) moved
 * CREDIT_COSTS.tailoringRun 5 -> 20 and rebased every credit pack and every
 * other action price with it — but the referral programme's two rewards are
 * granted from inside Postgres triggers (handle_new_user,
 * check_and_activate_referral — see migration 0092), which have no
 * TypeScript call site to read CREDIT_COSTS from. Nothing connected the two,
 * so the rebase silently left the signup bonus at 5 (a quarter of a bullet
 * rewrite) and the activation bonus at 20 (barely a fifth of the one action
 * this whole page exists to get people using — see
 * docs/referrals-open-questions.md and the tailoring-run repricing note).
 *
 * A referral was worth 5 tailoring runs before the rebase; after it, an
 * unfixed reward would have been worth 1.25 — three quarters of the
 * programme's value, gone, with nothing that would have caught it. This file
 * is the fix for THAT class of bug, not just this one instance: every
 * constant here is either denominated in an action (tailoring runs) or is
 * exercised by a live test (tests/referrals/referrals.test.ts) that reads
 * the REAL amount a trigger actually grants and compares it against the
 * value computed here — so the next repricing that forgets this file fails
 * that test, rather than silently shipping.
 *
 * THESE CREDIT VALUES MUST MATCH migration 0092's literals EXACTLY. Postgres
 * cannot import a TypeScript constant, so the migration still hard-codes a
 * number — this file, and the test that checks it live, are what keep that
 * number honest against a future repricing.
 */

/**
 * Deliberately NOT denominated in any action price. A bare signup is the
 * gameable step (no activation required — see the 10-per-30-days cap in
 * grant_referral_reward for what actually bounds it), so the reward stays a
 * small, flat, founder-chosen number rather than scaling with whatever the
 * flagship action costs. 10 was chosen specifically to be spendable — 5
 * bullet rewrites, or 2 scholarship eligibility checks — where the previous
 * 5 credits could not buy anything on its own.
 */
export const REFERRAL_SIGNUP_BONUS_CREDITS = 10;

/** The real prize, and the one that should read as one. */
export const REFERRAL_ACTIVATION_BONUS_TAILORING_RUNS = 2;

export const REFERRAL_ACTIVATION_BONUS_CREDITS =
  REFERRAL_ACTIVATION_BONUS_TAILORING_RUNS * CREDIT_COSTS.tailoringRun;
