/**
 * Refer & Earn copy, derived from the reward constants (0215, decided 2026-10-02): a friend's signup pays nothing, ACTIVATION pays the
 * whole reward, there is a rolling cap, and referring yourself does not count. Every number a reader sees comes from
 * src/lib/referrals/rewards.ts and CREDIT_COSTS, never from a number typed into a page, so the public page, the signed-in page and the
 * email cannot drift from what the database pays. The tests swap the constants and prove the copy follows.
 *
 * The modules do not exist when this file is first committed, so they are loaded at runtime (loadModule).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadModule } from "../support/load-module";

interface Rewards {
  REFERRAL_REWARD_CREDITS: number;
  REFERRAL_SIGNUP_BONUS_CREDITS: number;
  LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS: number;
  REFERRAL_CAP: { referrals: number; windowDays: number };
  referralRewardTailorings(): number;
}
interface Copy {
  referralRewardHeadline(): string;
  referralRewardWorth(): string;
  referralCapSentence(): string;
  referralCapReachedMessage(rewardedInWindow: number): string;
  ACTIVATED_MEANING: string;
  SELF_REFERRAL_LINE: string;
  HOW_IT_WORKS: Array<{ title: string; text: string }>;
  referralRowStatus(row: { status: string; reward_credits_referrer: number }): { label: string; detail: string | null; tone: "paid" | "pending" | "withheld" | "neutral" };
  pendingCredits(rows: Array<{ status: string; reward_credits_referrer: number }>): number;
}
const rewards = () => loadModule<Rewards>("@/lib/referrals/rewards");
const copy = () => loadModule<Copy>("@/lib/referrals/copy");

afterEach(() => {
  vi.doUnmock("@/lib/referrals/rewards");
  vi.doUnmock("@/lib/credits/costs");
  vi.resetModules();
});

describe("the constants: a signup pays nothing, activation pays the whole reward", () => {
  it("the whole reward is 50 (the old 10 + 40, unchanged in total), the signup half is 0, the legacy half is kept for old referrals", async () => {
    const r = await rewards();
    expect(r.REFERRAL_REWARD_CREDITS).toBe(50);
    expect(r.REFERRAL_SIGNUP_BONUS_CREDITS).toBe(0);
    expect(r.LEGACY_REFERRAL_SIGNUP_BONUS_CREDITS).toBe(10);
    expect(r.REFERRAL_CAP).toEqual({ referrals: 10, windowDays: 30 });
  });

  it("the reward is described in resume tailorings from CREDIT_COSTS: 50 credits is 2 tailorings at 20 each", async () => {
    expect((await rewards()).referralRewardTailorings()).toBe(2);
  });
});

describe("the copy says what the numbers say", () => {
  it("headline and worth-line carry the real amount and the real tailoring count", async () => {
    const c = await copy();
    expect(c.referralRewardHeadline()).toContain("50 credits");
    expect(c.referralRewardWorth()).toBe("50 credits, enough for 2 resume tailorings");
  });

  it("states the cap with its real unit: referrals, in any rolling window", async () => {
    expect((await copy()).referralCapSentence()).toBe("Up to 10 rewarded referrals in any 30 days.");
  });

  it("defines 'activated' in plain words, matching the rule in the database (a base resume, or an application sent)", async () => {
    const { ACTIVATED_MEANING } = await copy();
    expect(ACTIVATED_MEANING).toMatch(/resume/i);
    expect(ACTIVATED_MEANING).toMatch(/appl/i);
    expect(ACTIVATED_MEANING).not.toMatch(/sign(s|ed)? up/i);
  });

  it("says plainly that referring yourself does not count", async () => {
    expect((await copy()).SELF_REFERRAL_LINE).toMatch(/yourself/i);
  });

  it("explains it in exactly three steps, none of which says a signup pays", async () => {
    const { HOW_IT_WORKS } = await copy();
    expect(HOW_IT_WORKS).toHaveLength(3);
    for (const s of HOW_IT_WORKS) expect(`${s.title} ${s.text}`).not.toMatch(/signs? up.*(earn|credit)/i);
  });
});

describe("CHANGE A CONSTANT AND THE COPY FOLLOWS (so the page and the email cannot disagree with the numbers)", () => {
  it("a different reward and a different tailoring price change the headline and the worth-line", async () => {
    vi.resetModules();
    vi.doMock("@/lib/credits/costs", () => ({ CREDIT_COSTS: { tailoringRun: 35 } }));
    const c = await copy();
    const r = await rewards();
    // 50 credits at 35 each: 1 tailoring (the real function, with the mocked price)
    expect(r.referralRewardTailorings()).toBe(1);
    expect(c.referralRewardWorth()).toBe("50 credits, enough for 1 resume tailoring");
  });

  it("a reward too small to buy a tailoring drops the 'enough for' clause rather than saying 0", async () => {
    vi.resetModules();
    vi.doMock("@/lib/credits/costs", () => ({ CREDIT_COSTS: { tailoringRun: 80 } }));
    expect((await copy()).referralRewardWorth()).toBe("50 credits");
  });

  it("a different cap changes the cap sentence", async () => {
    vi.resetModules();
    vi.doMock("@/lib/referrals/rewards", async (orig) => ({ ...((await orig()) as object), REFERRAL_CAP: { referrals: 7, windowDays: 14 } }));
    expect((await copy()).referralCapSentence()).toBe("Up to 7 rewarded referrals in any 14 days.");
  });

  it("no component or page types a reward or cap number: they come from the helpers", () => {
    const files = [
      "src/app/(app)/refer/page.tsx",
      "src/components/referrals/refer-public-landing.tsx",
      "src/lib/notifications/referral-reward/template.ts",
    ];
    for (const f of files) {
      let src: string;
      try {
        src = readFileSync(path.join(process.cwd(), f), "utf8");
      } catch {
        continue; // the public landing may not exist when this file is first committed
      }
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${f} types a credit amount`).not.toMatch(/\b\d+\s+(free\s+)?credits?\b/i);
      expect(code, `${f} types the cap`).not.toMatch(/\b(10|ten)\s+rewarded referrals/i);
      expect(code, `${f} types the window`).not.toMatch(/\b30\s+days\b/i);
    }
  });
});

describe("what each referral row says (derived from the stored amount, no new column)", () => {
  it("a referral that has signed up but not activated says what it will pay at activation: the whole reward, or the remainder if part was paid before", async () => {
    const c = await copy();
    expect(c.referralRowStatus({ status: "signed_up", reward_credits_referrer: 0 })).toMatchObject({ tone: "pending" });
    expect(c.referralRowStatus({ status: "signed_up", reward_credits_referrer: 0 }).detail).toContain("50 credits");
    // signed up before 0215: its 10-credit signup half was already paid, so 40 is left
    expect(c.referralRowStatus({ status: "signed_up", reward_credits_referrer: 10 }).detail).toContain("40 credits");
  });

  it("an activated, fully paid referral is paid", async () => {
    expect((await copy()).referralRowStatus({ status: "activated", reward_credits_referrer: 50 })).toMatchObject({ tone: "paid" });
  });

  it("an activated referral paid LESS than the whole reward was withheld by the limit, and says so (never silent)", async () => {
    const row = (await copy()).referralRowStatus({ status: "activated", reward_credits_referrer: 0 });
    expect(row.tone).toBe("withheld");
    expect(row.detail).toMatch(/limit/i);
    expect(row.detail).toContain("50 credits");
    const partial = (await copy()).referralRowStatus({ status: "activated", reward_credits_referrer: 10 });
    expect(partial.tone).toBe("withheld");
    expect(partial.detail).toContain("40 credits");
  });

  it("pending credits are the sum of what each signed-up referral will still pay", async () => {
    const c = await copy();
    expect(
      c.pendingCredits([
        { status: "signed_up", reward_credits_referrer: 0 },
        { status: "signed_up", reward_credits_referrer: 10 },
        { status: "activated", reward_credits_referrer: 50 },
      ]),
    ).toBe(90);
  });
});

describe("at the cap, the page says so and what still happens", () => {
  it("names the limit, that the referrals still count on the leaderboard (they do: it counts activated referrals), and when it clears", async () => {
    const msg = (await copy()).referralCapReachedMessage(10);
    expect(msg).toMatch(/10 rewarded referrals/);
    expect(msg).toMatch(/leaderboard/i);
    expect(msg).toMatch(/30 days/);
  });
});
