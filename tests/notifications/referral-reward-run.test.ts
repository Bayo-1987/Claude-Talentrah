/**
 * runReferralRewardNotifications (src/lib/notifications/referral-reward/run.ts)
 * — the outbox drain the cron route calls. Real database, mocked Resend
 * (only to keep the test hermetic — the claim/stamp behaviour under test is
 * entirely about referral_reward_events, not about email delivery).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Referral-reward-run test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

vi.mock("@/lib/resend/client", () => ({
  getResendClient: () => ({
    emails: { send: async () => ({ data: { id: "mock" }, error: null }) },
  }),
}));

let referrerId: string;
let referredId: string;
const referralIds: string[] = [];
const eventIds: string[] = [];

beforeAll(async () => {
  const referrer = await createTestUser("rr-run-referrer");
  const referred = await createTestUser("rr-run-referred");
  referrerId = referrer.id;
  referredId = referred.id;
}, 60_000);

afterAll(async () => {
  await deleteTestUsers([referrerId, referredId]);
}, 60_000);

afterEach(async () => {
  if (eventIds.length) await admin.from("referral_reward_events").delete().in("id", eventIds);
  if (referralIds.length) await admin.from("referrals").delete().in("id", referralIds);
  eventIds.length = 0;
  referralIds.length = 0;
  await admin.from("user_notifications").delete().eq("type", "referral_reward").eq("user_id", referrerId);
});

/** A referral row + a matching outbox event, inserted directly rather than through a real signup — this suite is about the drain, not the trigger (referral-reward-events.test.ts already covers the trigger itself). */
async function seedEvent(notifiedAt: string | null = null) {
  const { data: referral, error: referralError } = await admin
    .from("referrals")
    .insert({ referrer_id: referrerId, referred_user_id: referredId, status: "signed_up", signed_up_at: new Date().toISOString() })
    .select("id")
    .single();
  if (referralError || !referral) throw referralError ?? new Error("no referral");
  referralIds.push(referral.id);

  const { data: event, error: eventError } = await admin
    .from("referral_reward_events")
    .insert({
      referral_id: referral.id,
      referrer_id: referrerId,
      referred_user_id: referredId,
      credits_granted: 10,
      reason: "referral_signup_bonus",
      notified_at: notifiedAt,
    })
    .select("id")
    .single();
  if (eventError || !event) throw eventError ?? new Error("no event");
  eventIds.push(event.id);
  return event.id;
}

describe("runReferralRewardNotifications", () => {
  it("processes a pending event, stamps notified_at, and writes the in-app notification", async () => {
    const eventId = await seedEvent();

    const { runReferralRewardNotifications } = await import("@/lib/notifications/referral-reward/run");
    const summary = await runReferralRewardNotifications();

    expect(summary.ok).toBe(true);
    expect(summary.sent).toBeGreaterThanOrEqual(1);

    const { data: row } = await admin.from("referral_reward_events").select("notified_at").eq("id", eventId).single();
    expect(row?.notified_at).not.toBeNull();

    const { data: notifications } = await admin
      .from("user_notifications")
      .select("id")
      .eq("type", "referral_reward")
      .eq("user_id", referrerId);
    expect((notifications ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("does not re-process an already-notified event", async () => {
    const alreadyNotified = new Date().toISOString();
    const eventId = await seedEvent(alreadyNotified);

    const { runReferralRewardNotifications } = await import("@/lib/notifications/referral-reward/run");
    await runReferralRewardNotifications();

    const { data: row } = await admin.from("referral_reward_events").select("notified_at").eq("id", eventId).single();
    // Untouched — still the original stamp, not overwritten by this run.
    expect(row?.notified_at).toBe(alreadyNotified);
  });

  it("a second concurrent claim of the same event sees zero rows — the conditional UPDATE is the lock", async () => {
    await seedEvent();

    const supabase = admin;
    const eventId = eventIds[0];

    const [first, second] = await Promise.all([
      supabase.from("referral_reward_events").update({ notified_at: new Date().toISOString() }).eq("id", eventId).is("notified_at", null).select("id"),
      supabase.from("referral_reward_events").update({ notified_at: new Date().toISOString() }).eq("id", eventId).is("notified_at", null).select("id"),
    ]);

    const claimedCount = (first.data?.length ?? 0) + (second.data?.length ?? 0);
    expect(claimedCount, "exactly one of the two concurrent claims should have matched the row").toBe(1);
  });
});
