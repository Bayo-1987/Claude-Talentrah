/**
 * send-512 / PR 0 (migration 0209) — deleting a user must not delete their financial or counterparty records.
 *
 * Before 0209 every one of these foreign keys into `profiles` was ON DELETE CASCADE: removing a profile (a hand delete in the Supabase dashboard,
 * `auth.admin.deleteUser`, a future purge) silently wiped the person's payments, credit ledger, Passes, the referral rows that decide SOMEONE ELSE'S
 * reward, and the mentorship sessions and reviews that are also the mentor's records.
 *
 * What this pins, against the real database:
 *   1. THE CATALOG: each of the nine foreign keys reads SET NULL and its column is nullable (via account_deletion_fk_catalog(), because
 *      supabase-js cannot query pg_catalog).
 *   2. THE CASCADE: delete a user who has a payment, a ledger entry, a referral (both sides), a reward event, a mentorship session (mentee side) and a
 *      review. Every row survives with the user's id null, the mentee's free-text notes are gone, the mentor's notes and the session are not.
 *   3. THE TRIGGER (enforce_mentorship_session_notes_ownership) never raises during the SET NULL when auth.uid() is null (the service role / GoTrue
 *      admin path, which is what deletes users here), and still guards notes for an authenticated mentor afterwards. supabase-js cannot start a user-
 *      context transaction that deletes a profile; the same cascade was also run with a NON-NULL auth.uid() in the session on the preview project
 *      (output in the PR body).
 *   4. MONEY TOTALS: the admin finance health numbers are identical before and after the deletion.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers, sessionFor } from "../support/auth";
import { financialHealth } from "@/lib/admin/finance/queries";
import { monthRange } from "@/lib/referrals/leaderboard";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`money-survives-user-deletion test cannot run: ${key} is not set.`);
}

const EXPECTED_SET_NULL: Array<[string, string]> = [
  ["payment_transactions", "user_id"],
  ["credit_ledger", "user_id"],
  ["user_passes", "user_id"],
  ["referral_reward_events", "referrer_id"],
  ["referral_reward_events", "referred_user_id"],
  ["referrals", "referrer_id"],
  ["referrals", "referred_user_id"],
  ["mentorship_sessions", "mentee_id"],
  ["mentorship_reviews", "reviewer_id"],
];

describe("the foreign-key catalog", () => {
  it.each(EXPECTED_SET_NULL)("%s.%s into profiles is ON DELETE SET NULL and nullable", async (table, column) => {
    const { data, error } = await admin.rpc("account_deletion_fk_catalog");
    expect(error).toBeNull();
    const fk = (data ?? []).find((r) => r.child_table === table && r.child_column === column && r.parent_table === "profiles");
    expect(fk, `${table}.${column} -> profiles`).toBeTruthy();
    expect(fk!.on_delete).toBe("SET NULL");
    expect(fk!.nullable).toBe(true);
  });

  it("the catalog function is service-role only (anon and authenticated cannot read it)", async () => {
    const anon = (await import("@supabase/supabase-js")).createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    const { error } = await anon.rpc("account_deletion_fk_catalog" as never);
    expect(error).not.toBeNull();
  });
});

describe("deleting a user keeps their money and counterparty records", () => {
  const stamp = randomUUID();
  let leaverId = "";
  let friendId = "";
  let mentor: { id: string; email: string };
  let sessionId = "";
  let slotId = "";
  let paymentRef = "";
  let before: Awaited<ReturnType<typeof financialHealth>>;

  beforeAll(async () => {
    const leaver = await admin.auth.admin.createUser({ email: `leaver-${stamp}@talentrah.test`, email_confirm: true });
    const friend = await admin.auth.admin.createUser({ email: `friend-${stamp}@talentrah.test`, email_confirm: true });
    if (leaver.error || friend.error) throw new Error(`could not create fixture users: ${leaver.error?.message ?? friend.error?.message}`);
    leaverId = leaver.data.user.id;
    friendId = friend.data.user.id;
    mentor = await createTestUser("mentor-keeps");

    const { data: pack, error: packError } = await admin.from("credit_packs").select("id, price_ngn").limit(1).single();
    if (packError || !pack) throw new Error("No credit packs seeded — run `npm run seed`.");

    paymentRef = `credit_pack_${stamp}`;
    const ins = async (label: string, p: PromiseLike<{ error: { message: string } | null }>) => {
      const { error } = await p;
      if (error) throw new Error(`fixture ${label}: ${error.message}`);
    };
    await ins("payment", admin.from("payment_transactions").insert({ user_id: leaverId, amount: pack.price_ngn, product_type: "credit_pack", product_id: pack.id, paystack_reference: paymentRef, status: "success" }));
    await ins("ledger", admin.from("credit_ledger").insert({ user_id: leaverId, delta: 7, reason: "admin_adjustment", balance_after: 7 }));

    const { data: referral, error: refError } = await admin.from("referrals").insert({ referrer_id: leaverId, referred_user_id: friendId, status: "signed_up" }).select("id").single();
    if (refError || !referral) throw new Error(`fixture referral: ${refError?.message}`);
    await ins("reward event", admin.from("referral_reward_events").insert({ referral_id: referral.id, referrer_id: leaverId, referred_user_id: friendId, credits_granted: 5, reason: "referral_signup_bonus" }));

    await ins("mentor profile", admin.from("mentor_profiles").upsert({ user_id: mentor.id, status: "approved" }));
    const start = new Date(Date.now() + 5 * 86_400_000);
    const { data: slot, error: slotError } = await admin.from("mentor_availability_slots").insert({ mentor_id: mentor.id, start_at: start.toISOString(), end_at: new Date(start.getTime() + 3_600_000).toISOString(), is_booked: true }).select("id").single();
    if (slotError || !slot) throw new Error(`fixture slot: ${slotError?.message}`);
    slotId = slot.id;
    const { data: session, error: sessionError } = await admin
      .from("mentorship_sessions")
      .insert({ mentor_id: mentor.id, mentee_id: leaverId, availability_slot_id: slotId, session_type: "mock_interview", scheduled_start: start.toISOString(), scheduled_end: new Date(start.getTime() + 3_600_000).toISOString(), status: "confirmed", mentee_notes: "my private notes", mentor_notes: "mentor's own notes" })
      .select("id")
      .single();
    if (sessionError || !session) throw new Error(`fixture session: ${sessionError?.message}`);
    sessionId = session.id;
    await ins("review", admin.from("mentorship_reviews").insert({ session_id: sessionId, mentor_id: mentor.id, reviewer_id: leaverId, rating: 5 }));

    before = await financialHealth();
  }, 120_000);

  /** A delete that is refused resolves with an error rather than throwing; cleanup that ignored it would leave rows behind in the shared database. */
  const check = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) throw new Error(`cleanup failed: ${error.message}`);
  };

  afterAll(async () => {
    if (sessionId) {
      await check(admin.from("mentorship_reviews").delete().eq("session_id", sessionId));
      await check(admin.from("mentorship_sessions").delete().eq("id", sessionId));
    }
    if (slotId) await check(admin.from("mentor_availability_slots").delete().eq("id", slotId));
    if (mentor) await check(admin.from("mentor_profiles").delete().eq("user_id", mentor.id));
    await check(admin.from("payment_transactions").delete().eq("paystack_reference", paymentRef));
    await check(admin.from("credit_ledger").delete().is("user_id", null).eq("reason", "admin_adjustment").eq("delta", 7).eq("balance_after", 7));
    // Before the friend is deleted: deleting them would detach these rows (SET NULL) and leave orphans with both sides null.
    if (friendId) {
      await check(admin.from("referral_reward_events").delete().eq("referred_user_id", friendId));
      await check(admin.from("referrals").delete().eq("referred_user_id", friendId));
    }
    if (friendId) await admin.auth.admin.deleteUser(friendId);
    if (mentor) await deleteTestUsers([mentor.id]);
  }, 120_000);

  it("every row survives the deletion with the user's id null; the mentee's notes go, the mentor's stay", async () => {
    const { error: delError } = await admin.auth.admin.deleteUser(leaverId);
    expect(delError).toBeNull();
    const { data: profile } = await admin.from("profiles").select("id").eq("id", leaverId).maybeSingle();
    expect(profile, "the profile is really gone").toBeNull();

    const { data: payment } = await admin.from("payment_transactions").select("user_id, status").eq("paystack_reference", paymentRef).single();
    expect(payment).toEqual({ user_id: null, status: "success" });

    const { data: ledger } = await admin.from("credit_ledger").select("user_id").eq("reason", "admin_adjustment").eq("delta", 7).eq("balance_after", 7).is("user_id", null);
    expect(ledger).toHaveLength(1);

    const { data: referrals } = await admin.from("referrals").select("referrer_id, referred_user_id").eq("referred_user_id", friendId);
    expect(referrals).toEqual([{ referrer_id: null, referred_user_id: friendId }]);
    const { data: events } = await admin.from("referral_reward_events").select("referrer_id, referred_user_id, credits_granted").eq("referred_user_id", friendId);
    expect(events).toEqual([{ referrer_id: null, referred_user_id: friendId, credits_granted: 5 }]);

    const { data: session } = await admin.from("mentorship_sessions").select("mentee_id, mentee_notes, mentor_notes, status").eq("id", sessionId).single();
    expect(session).toEqual({ mentee_id: null, mentee_notes: null, mentor_notes: "mentor's own notes", status: "confirmed" });
    const { data: review } = await admin.from("mentorship_reviews").select("reviewer_id, rating").eq("session_id", sessionId).single();
    expect(review).toEqual({ reviewer_id: null, rating: 5 });
  }, 60_000);

  it("the finance health totals are identical before and after the deletion", async () => {
    const after = await financialHealth();
    expect(after).toEqual(before);
  });

  it("the notes trigger still lets the authenticated mentor edit their OWN notes on the detached session, and still refuses a stranger", async () => {
    const mentorClient = await sessionFor(mentor.email, mentor.id);
    const own = await mentorClient.from("mentorship_sessions").update({ mentor_notes: "edited by the mentor" }).eq("id", sessionId).select("mentor_notes");
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{ mentor_notes: "edited by the mentor" }]);

    const stranger = await createTestUser("stranger-notes");
    try {
      const strangerClient = await sessionFor(stranger.email, stranger.id);
      const refused = await strangerClient.from("mentorship_sessions").update({ mentor_notes: "stranger edit" }).eq("id", sessionId).select("mentor_notes");
      // Either a column-level/RLS denial (error) or zero rows; never a successful edit.
      expect(refused.data ?? []).toEqual([]);
    } finally {
      await deleteTestUsers([stranger.id]);
    }
  }, 60_000);
});

describe("a referrer's history does not shrink when someone they referred deletes their account", () => {
  const stamp = randomUUID().slice(0, 8);
  const ids: { referrer?: string; x?: string; y?: string; gone?: string; goneReferred?: string } = {};
  let referrerEmail = "";
  const referrerName = `Ref ${stamp} Keeps`;
  const goneName = `Ref ${stamp} Gone`;

  async function user(label: string) {
    const { data, error } = await admin.auth.admin.createUser({ email: `${label}-${stamp}@talentrah.test`, email_confirm: true });
    if (error || !data.user) throw new Error(`could not create ${label}: ${error?.message}`);
    return data.user;
  }
  const check = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) throw new Error(`fixture/cleanup failed: ${error.message}`);
  };

  async function leaderboardFor(viewerId: string, viewerEmail: string) {
    const period = monthRange(new Date());
    const client = await sessionFor(viewerEmail, viewerId);
    const { data, error } = await client.rpc("referral_leaderboard", { p_period_start: period.start, p_period_end: period.end, p_limit: 100 });
    expect(error).toBeNull();
    return data ?? [];
  }

  async function ownReferralStats(referrerId: string) {
    const { data } = await admin.from("referrals").select("status, reward_credits_referrer").eq("referrer_id", referrerId);
    const rows = data ?? [];
    return {
      signedUp: rows.filter((r) => r.status === "signed_up" || r.status === "activated").length,
      activated: rows.filter((r) => r.status === "activated").length,
      creditsEarned: rows.reduce((sum, r) => sum + r.reward_credits_referrer, 0),
    };
  }

  beforeAll(async () => {
    const referrer = await user("lb-referrer");
    const x = await user("lb-x");
    const y = await user("lb-y");
    const gone = await user("lb-gone");
    const goneReferred = await user("lb-gone-referred");
    Object.assign(ids, { referrer: referrer.id, x: x.id, y: y.id, gone: gone.id, goneReferred: goneReferred.id });
    referrerEmail = referrer.email!;
    const now = new Date().toISOString();
    await check(admin.from("profiles").update({ referral_leaderboard_opt_in: true, referral_leaderboard_display_name: referrerName }).eq("id", referrer.id));
    await check(admin.from("profiles").update({ referral_leaderboard_opt_in: true, referral_leaderboard_display_name: goneName }).eq("id", gone.id));
    await check(admin.from("referrals").insert([
      { referrer_id: referrer.id, referred_user_id: x.id, status: "activated", activated_at: now, reward_credits_referrer: 5 },
      { referrer_id: referrer.id, referred_user_id: y.id, status: "activated", activated_at: now, reward_credits_referrer: 5 },
      { referrer_id: gone.id, referred_user_id: goneReferred.id, status: "activated", activated_at: now, reward_credits_referrer: 5 },
    ]));
  }, 120_000);

  afterAll(async () => {
    for (const id of [ids.referrer, ids.x, ids.y, ids.gone, ids.goneReferred]) {
      if (id) await check(admin.from("referrals").delete().or(`referrer_id.eq.${id},referred_user_id.eq.${id}`));
    }
    // Rows detached by the deletions below have both sides null and cannot be found by id; they are identified by the fixture amounts and stamp period.
    await check(admin.from("referrals").delete().is("referrer_id", null).is("referred_user_id", null).eq("status", "activated").eq("reward_credits_referrer", 5));
    for (const id of [ids.referrer, ids.y, ids.goneReferred]) if (id) await admin.auth.admin.deleteUser(id);
  }, 120_000);

  it("deleting a referred user leaves the referrer's count, rewards and leaderboard position exactly as they were", async () => {
    const boardBefore = await leaderboardFor(ids.referrer!, referrerEmail);
    const mineBefore = boardBefore.find((r) => r.display_name === referrerName);
    expect(mineBefore, "the referrer is on the board").toBeTruthy();
    expect(mineBefore!.activated_count).toBe(2);
    const statsBefore = await ownReferralStats(ids.referrer!);
    expect(statsBefore).toEqual({ signedUp: 2, activated: 2, creditsEarned: 10 });

    const { error } = await admin.auth.admin.deleteUser(ids.x!);
    expect(error).toBeNull();
    const { data: detached } = await admin.from("referrals").select("referrer_id, referred_user_id, status").eq("referrer_id", ids.referrer!).is("referred_user_id", null);
    expect(detached, "the row survives, detached on the referred side").toEqual([{ referrer_id: ids.referrer, referred_user_id: null, status: "activated" }]);

    const boardAfter = await leaderboardFor(ids.referrer!, referrerEmail);
    const mineAfter = boardAfter.find((r) => r.display_name === referrerName);
    expect(mineAfter).toEqual(mineBefore);
    expect(await ownReferralStats(ids.referrer!)).toEqual(statsBefore);
  }, 60_000);

  it("rows whose REFERRER was deleted are left off the leaderboard entirely, not shown as an empty entry", async () => {
    const before = await leaderboardFor(ids.referrer!, referrerEmail);
    expect(before.some((r) => r.display_name === goneName), "present while they exist").toBe(true);

    const { error } = await admin.auth.admin.deleteUser(ids.gone!);
    expect(error).toBeNull();
    const { data: orphan } = await admin.from("referrals").select("referrer_id, referred_user_id").eq("referred_user_id", ids.goneReferred!);
    expect(orphan, "the row survives with a null referrer").toEqual([{ referrer_id: null, referred_user_id: ids.goneReferred }]);

    const after = await leaderboardFor(ids.referrer!, referrerEmail);
    expect(after.some((r) => r.display_name === goneName)).toBe(false);
    expect(after.every((r) => typeof r.display_name === "string" && r.display_name.length > 0), "no null or blank entry").toBe(true);
    expect(after.length).toBe(before.length - 1);
  }, 60_000);
});
