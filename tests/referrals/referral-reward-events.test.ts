/**
 * send-462 — the outbox migration 0195 adds to `grant_referral_reward`.
 *
 * Real signups and real triggers, same discipline referrals.test.ts already
 * uses for this exact function: a hand-rolled reimplementation of the
 * trigger's logic would pass while the trigger itself stayed wrong.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/supabase/types";
import { REFERRAL_REWARD_CREDITS } from "@/lib/referrals/rewards";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Referral-reward-events test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let created: string[] = [];

async function makeUser(email: string, meta?: Record<string, unknown>): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: meta });
    if (!error) {
      created.push(data.user!.id);
      return data.user!.id;
    }
    if (!/rate limit/i.test(error.message) || attempt >= 3) throw error;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
}

function gmail(tag: string): string {
  return `rre-${tag}-${randomUUID().slice(0, 8)}@gmail.com`;
}

async function referralCodeOf(userId: string): Promise<string> {
  const { data } = await admin.from("profiles").select("referral_code").eq("id", userId).single();
  return data!.referral_code;
}

async function eventsFor(referrerId: string) {
  const { data, error } = await admin
    .from("referral_reward_events")
    .select("id, referrer_id, referred_user_id, credits_granted, reason, notified_at")
    .eq("referrer_id", referrerId);
  if (error) throw new Error(`eventsFor(${referrerId}) failed: ${error.message}`);
  return data ?? [];
}

/** A referred user activates (a base resume): since 0215 that, not the signup, is what pays and what writes the outbox row. */
async function activate(referredId: string) {
  const { error } = await admin.from("resumes").insert({
    user_id: referredId,
    title: "Base",
    is_base: true,
    source: "uploaded",
    structured_content: {},
  });
  if (error) throw error;
  await new Promise((r) => setTimeout(r, 1200));
}

/** Same shape as referrals.test.ts's own seedRewardedReferrals — fills the 30-day cap without real signups. */
async function seedRewardedReferrals(referrerId: string, n: number) {
  const rows = Array.from({ length: n }, () => ({
    user_id: referrerId,
    delta: REFERRAL_REWARD_CREDITS,
    reason: "referral_activation_bonus" as const,
    related_entity_id: randomUUID(),
    balance_after: 0,
    created_at: new Date().toISOString(),
  }));
  const { error } = await admin.from("credit_ledger").insert(rows);
  if (error) throw error;
}

beforeEach(() => {
  created = [];
});

afterEach(async () => {
  await Promise.all(created.map((id) => admin.auth.admin.deleteUser(id).catch(() => {})));
  created = [];
});

describe("referral_reward_events — the outbox grant_referral_reward writes to", () => {
  it("a signup alone produces NO event row (it pays nothing since 0215); activation produces exactly one, unnotified, for the whole reward", async () => {
    const referrer = await makeUser(gmail("outbox-r"));
    const code = await referralCodeOf(referrer);
    const referred = await makeUser(gmail("outbox-b"), { referred_by_code: code });
    expect(await eventsFor(referrer), "a signup pays nothing, so it must not notify").toHaveLength(0);

    await activate(referred);

    const events = await eventsFor(referrer);
    expect(events).toHaveLength(1);
    expect(events[0].referred_user_id).toBe(referred);
    expect(events[0].reason).toBe("referral_activation_bonus");
    expect(events[0].credits_granted).toBe(REFERRAL_REWARD_CREDITS);
    expect(events[0].notified_at).toBeNull();
  });

  it("a capped-out grant (30-day/10-referral cap) produces NO event row — the hook only fires on an actual grant", async () => {
    const referrer = await makeUser(gmail("outbox-cap-r"));
    const code = await referralCodeOf(referrer);

    // Fill the cap with 10 already-rewarded referrals.
    await seedRewardedReferrals(referrer, 10);

    // The 11th activation must be blocked by the cap — grant_referral_reward
    // returns early, before the new insert this migration added.
    await activate(await makeUser(gmail("outbox-cap-11"), { referred_by_code: code }));

    const events = await eventsFor(referrer);
    expect(events, "a capped call must not produce an outbox row").toHaveLength(0);
  });
});
