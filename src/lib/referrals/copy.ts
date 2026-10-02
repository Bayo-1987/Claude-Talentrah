import { REFERRAL_CAP, REFERRAL_REWARD_CREDITS, referralRewardTailorings } from "./rewards";

/**
 * Refer & Earn wording, for the public /refer page, the signed-in /refer page and (via the same constants) the reward email.
 *
 * Every number is read from rewards.ts and CREDIT_COSTS here; nothing that renders types one. tests/referrals/referral-copy.test.ts
 * swaps the constants and proves the copy follows, and scans the pages for a typed-in amount.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function referralRewardHeadline(): string {
  return `Bring a friend, earn ${REFERRAL_REWARD_CREDITS} credits.`;
}

/** "50 credits, enough for 2 resume tailorings"; just "50 credits" when the reward would not buy one at the current price. */
export function referralRewardWorth(): string {
  const t = referralRewardTailorings();
  const base = `${REFERRAL_REWARD_CREDITS} credits`;
  return t >= 1 ? `${base}, enough for ${t} resume ${plural(t, "tailoring", "tailorings")}` : base;
}

export function referralCapSentence(): string {
  return `Up to ${REFERRAL_CAP.referrals} rewarded referrals in any ${REFERRAL_CAP.windowDays} days.`;
}

/**
 * "Activated", in plain words, matching what the database checks (check_and_activate_referral): a base resume saved, or an application
 * sent. It is deliberately NOT the signup.
 */
export const ACTIVATED_MEANING =
  "A friend counts as activated once they have saved a resume to their Talentrah account or applied to a job.";

export const SELF_REFERRAL_LINE =
  "Referring yourself, or another address of your own, doesn't count.";

export const HOW_IT_WORKS: Array<{ title: string; text: string }> = [
  { title: "Share your link", text: "Every account gets its own link. Send it to a friend who is job hunting." },
  { title: "They create an account", text: "They create an account through your link. Nothing is paid at this stage." },
  { title: "You are paid when they activate", text: `${ACTIVATED_MEANING} That is when the reward arrives in your account.` },
];

/** Shown when the referrer is at the cap: what the limit is, what still happens, and when it clears. */
export function referralCapReachedMessage(rewardedInWindow: number): string {
  return (
    `You have reached the limit: ${rewardedInWindow} rewarded ${plural(rewardedInWindow, "referral", "referrals")} in the last ${REFERRAL_CAP.windowDays} days. ` +
    "Friends who activate while you are at the limit still count on the leaderboard, but pay no credits. " +
    `The limit clears as your oldest rewarded referral passes ${REFERRAL_CAP.windowDays} days.`
  );
}

interface RowLike {
  status: string;
  reward_credits_referrer: number;
}

const remaining = (r: RowLike) => Math.max(0, REFERRAL_REWARD_CREDITS - r.reward_credits_referrer);

/**
 * What a referral row says, derived from the stored amount alone (no new column):
 *  - signed up: pays what is left of the whole reward when they activate (all of it, or the remainder for a referral whose signup half
 *    was paid before 0215);
 *  - activated and paid the whole reward: paid;
 *  - activated and paid LESS: the limit withheld it, and the row says so, so nothing is ever silently unpaid.
 */
export function referralRowStatus(row: RowLike): { label: string; detail: string | null; tone: "paid" | "pending" | "withheld" | "neutral" } {
  if (row.status === "signed_up") {
    return { label: "Signed up", detail: `Pays ${remaining(row)} credits when they activate`, tone: "pending" };
  }
  if (row.status === "activated") {
    if (row.reward_credits_referrer >= REFERRAL_REWARD_CREDITS) return { label: "Activated", detail: null, tone: "paid" };
    return {
      label: "Activated",
      detail: `The limit of ${REFERRAL_CAP.referrals} rewarded referrals in ${REFERRAL_CAP.windowDays} days was reached, so ${remaining(row)} credits were not paid`,
      tone: "withheld",
    };
  }
  return { label: "Invited", detail: null, tone: "neutral" };
}

/** What every signed-up referral will still pay once it activates. */
export function pendingCredits(rows: RowLike[]): number {
  return rows.filter((r) => r.status === "signed_up").reduce((sum, r) => sum + remaining(r), 0);
}
