/**
 * send-512 / PR 0 — a referral reward event whose referrer's (or referred person's) account was deleted.
 *
 * 0209 keeps the event, detached (referrer_id / referred_user_id become null). The notification job must not crash on it: with no referrer there
 * is nobody to tell (the event is simply stamped notified), and with no referred person the referrer is still told, naming "a friend".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  claimed: null as null | Record<string, unknown>,
  send: vi.fn(async () => undefined),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => {
      let op = "select";
      const q: Record<string, unknown> = {
        select: () => q,
        update: () => {
          op = "update";
          return q;
        },
        is: () => q,
        eq: () => q,
        order: () => q,
        limit: async () => ({ data: [{ id: "ev-1" }], error: null }),
        maybeSingle: async () => ({ data: op === "update" ? h.claimed : null, error: null }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/notifications/referral-reward/send", () => ({ sendReferralRewardNotification: h.send }));

beforeEach(() => h.send.mockClear());

const event = (over: Record<string, unknown>) => ({ id: "ev-1", referrer_id: "r1", referred_user_id: "u1", credits_granted: 5, reason: "referral_signup_bonus", ...over });

describe("runReferralRewardNotifications with a deleted party", () => {
  it("no referrer: nobody is notified, the run does not fail", async () => {
    h.claimed = event({ referrer_id: null });
    const { runReferralRewardNotifications } = await import("@/lib/notifications/referral-reward/run");
    const summary = await runReferralRewardNotifications();
    expect(h.send).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ ok: true, failed: 0, sent: 0 });
  });

  it("no referred person: the referrer is still told, with a null referred id", async () => {
    h.claimed = event({ referred_user_id: null });
    const { runReferralRewardNotifications } = await import("@/lib/notifications/referral-reward/run");
    const summary = await runReferralRewardNotifications();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ referrerId: "r1", referredUserId: null }));
    expect(summary).toMatchObject({ ok: true, sent: 1 });
  });

  it("both parties present: unchanged", async () => {
    h.claimed = event({});
    const { runReferralRewardNotifications } = await import("@/lib/notifications/referral-reward/run");
    await runReferralRewardNotifications();
    expect(h.send).toHaveBeenCalledWith(expect.objectContaining({ referrerId: "r1", referredUserId: "u1" }));
  });
});
