/**
 * Root-cause regression for the recurring `mentor_profiles_pkey` CI flake.
 *
 * THE FLAKE. Fixtures that do a bare `admin.from("mentor_profiles").insert(...)`
 * for a pooled test user (tests/support/auth.ts, migration 0188) intermittently
 * fail with `duplicate key value violates unique constraint
 * "mentor_profiles_pkey"`. It hit reviewer-claim-race.test.ts (#562),
 * dual-role-isolation.test.ts (#563) and display-name.test.ts (PR #572's CI) in
 * one day, and ~20 files carry the same bare insert.
 *
 * THE CAUSE. `reset_test_pool_user` runs when a pooled identity is re-claimed
 * and is meant to hand back a clean user. For a user who had been a MENTOR it
 * could not: it deleted `mentor_profiles` first (blocked, so left in place),
 * then only cleared `mentorship_sessions` where the user was the MENTEE
 * (`mentee_id`), never where they were the mentor, and never touched
 * `mentor_payouts` at all. The rows that actually block a mentor_profiles
 * delete are all NO ACTION and NOT NULL:
 *     mentorship_sessions.mentor_id, mentorship_reviews.mentor_id,
 *     mentor_payouts.mentor_id
 * and `mentor_payouts.session_id` / `mentorship_sessions.availability_slot_id`
 * block the deletes that would clear them. So a pooled user that had run a
 * real mentor session kept its mentor_profiles row, and the next test to claim
 * that identity collided on insert.
 *
 * WHAT THIS PINS. After `reset_test_pool_user`:
 *   1. a former MENTOR comes back with no mentor_profiles row — and none of the
 *      sessions / payouts / reviews / slots that hang off it;
 *   2. a former MENTEE's sessions go, INCLUDING ones a payout references;
 *   3. neither of the above touches an unrelated user's rows (the other side of
 *      a session survives: this is a reset of ONE identity, not a wipe);
 *   4. the actual symptom is gone: a bare insert into mentor_profiles for the
 *      reused id succeeds.
 *
 * Proven the repo's way: written first, run against the unfixed function (red),
 * then fixed (green). The reset is called directly rather than through
 * claim/release because `claim_test_pool_user` cannot be asked for a specific
 * row (see test-user-pool.test.ts) and this needs one identity, on purpose.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { admin, createTestUser, deleteTestUsers } from "./auth";

const createdUserIds: string[] = [];
const extraRowCleanup: Array<() => Promise<unknown>> = [];

afterAll(async () => {
  for (const cleanup of extraRowCleanup.reverse()) await cleanup().catch(() => {});
  if (createdUserIds.length) await deleteTestUsers(createdUserIds).catch(() => {});
});

async function newUser(prefix: string) {
  const user = await createTestUser(prefix);
  createdUserIds.push(user.id);
  return user;
}

/** A booked slot plus a mentorship_sessions row on it, inserted directly so no RPC/trigger/price logic is in play. */
async function makeSession(mentorId: string, menteeId: string) {
  const start = new Date(Date.now() + 24 * 3600_000);
  const end = new Date(start.getTime() + 3600_000);
  const { data: slot, error: slotError } = await admin
    .from("mentor_availability_slots")
    .insert({ mentor_id: mentorId, start_at: start.toISOString(), end_at: end.toISOString(), is_booked: true })
    .select("id")
    .single();
  if (slotError || !slot) throw slotError ?? new Error("no slot");

  const { data: session, error } = await admin
    .from("mentorship_sessions")
    .insert({
      mentor_id: mentorId,
      mentee_id: menteeId,
      availability_slot_id: slot.id,
      session_type: "resume_review",
      scheduled_start: start.toISOString(),
      scheduled_end: end.toISOString(),
    })
    .select("id")
    .single();
  if (error || !session) throw error ?? new Error("no session");
  return { sessionId: session.id, slotId: slot.id };
}

async function makePayout(sessionId: string, mentorId: string) {
  const { error } = await admin.from("mentor_payouts").insert({
    session_id: sessionId,
    mentor_id: mentorId,
    amount_ngn: 12_750,
    eligible_at: new Date(Date.now() + 72 * 3600_000).toISOString(),
  });
  if (error) throw error;
}

async function makeReview(sessionId: string, mentorId: string, reviewerId: string) {
  const { error } = await admin
    .from("mentorship_reviews")
    .insert({ session_id: sessionId, mentor_id: mentorId, reviewer_id: reviewerId, rating: 5 });
  if (error) throw error;
}

async function reset(userId: string) {
  const { error } = await admin.rpc("reset_test_pool_user", {
    p_user_id: userId,
    p_new_email: `pool-reset-${randomUUID()}@talentrah.test`,
  });
  if (error) throw error;
}

async function count(table: string, column: string, value: string): Promise<number> {
  const { count: n, error } = await admin
    .from(table as never)
    .select("*", { count: "exact", head: true })
    .eq(column, value);
  if (error) throw error;
  return n ?? 0;
}

describe("reset_test_pool_user hands back a clean identity to a former mentor / mentee", () => {
  it("a former MENTOR comes back with no mentor_profiles row and none of its dependents", async () => {
    const mentor = await newUser("poolreset-mentor");
    const mentee = await newUser("poolreset-mentee");

    const { error: profileError } = await admin
      .from("mentor_profiles")
      .upsert({ user_id: mentor.id, status: "approved", base_price_ngn: 10_000 }, { onConflict: "user_id" });
    if (profileError) throw profileError;

    const { sessionId } = await makeSession(mentor.id, mentee.id);
    await makePayout(sessionId, mentor.id);
    await makeReview(sessionId, mentor.id, mentee.id);
    // A second, unbooked slot that has no session hanging off it.
    await admin.from("mentor_availability_slots").insert({
      mentor_id: mentor.id,
      start_at: new Date(Date.now() + 48 * 3600_000).toISOString(),
      end_at: new Date(Date.now() + 49 * 3600_000).toISOString(),
    });

    // Precondition: the residual really exists, or this test proves nothing.
    expect(await count("mentor_profiles", "user_id", mentor.id)).toBe(1);
    expect(await count("mentor_payouts", "mentor_id", mentor.id)).toBe(1);

    await reset(mentor.id);

    expect(
      await count("mentor_profiles", "user_id", mentor.id),
      "the reused identity still carries a mentor_profiles row — the next claimant's bare insert collides on mentor_profiles_pkey",
    ).toBe(0);
    expect(await count("mentorship_sessions", "mentor_id", mentor.id)).toBe(0);
    expect(await count("mentor_payouts", "mentor_id", mentor.id)).toBe(0);
    expect(await count("mentorship_reviews", "mentor_id", mentor.id)).toBe(0);
    expect(await count("mentor_availability_slots", "mentor_id", mentor.id)).toBe(0);

    // The unrelated other party is untouched: still a real user.
    expect(await count("profiles", "id", mentee.id)).toBe(1);

    // And the actual CI symptom is gone: a bare insert for the reused id works.
    const { error: bareInsertError } = await admin
      .from("mentor_profiles")
      .insert({ user_id: mentor.id, status: "pending" });
    expect(bareInsertError, "a bare insert for a reset pool user must not collide").toBeNull();
    await admin.from("mentor_profiles").delete().eq("user_id", mentor.id);
  });

  it("a former MENTEE's sessions are cleared even when a payout references them — without touching the mentor's own row or their other sessions", async () => {
    const mentorX = await newUser("poolreset-mentor-x");
    const menteeM = await newUser("poolreset-mentee-m");
    const menteeC = await newUser("poolreset-mentee-c");

    const { error: profileError } = await admin
      .from("mentor_profiles")
      .upsert({ user_id: mentorX.id, status: "approved", base_price_ngn: 10_000 }, { onConflict: "user_id" });
    if (profileError) throw profileError;
    extraRowCleanup.push(async () => {
      await admin.from("mentor_payouts").delete().eq("mentor_id", mentorX.id);
      await admin.from("mentorship_reviews").delete().eq("mentor_id", mentorX.id);
      await admin.from("mentorship_sessions").delete().eq("mentor_id", mentorX.id);
      await admin.from("mentor_profiles").delete().eq("user_id", mentorX.id);
    });

    const withM = await makeSession(mentorX.id, menteeM.id);
    await makePayout(withM.sessionId, mentorX.id); // the payout that blocks deleting M's session
    const withC = await makeSession(mentorX.id, menteeC.id);
    await makePayout(withC.sessionId, mentorX.id);

    expect(await count("mentorship_sessions", "mentee_id", menteeM.id)).toBe(1);

    await reset(menteeM.id);

    expect(
      await count("mentorship_sessions", "mentee_id", menteeM.id),
      "the former mentee still has a session — a payout referencing it blocked the delete",
    ).toBe(0);
    expect(await count("mentor_payouts", "session_id", withM.sessionId)).toBe(0);

    // Isolation: this reset is ONE identity, not a wipe of the mentor it dealt with.
    expect(await count("mentor_profiles", "user_id", mentorX.id), "reset of a mentee must not delete the mentor").toBe(1);
    expect(await count("mentorship_sessions", "mentee_id", menteeC.id), "another mentee's session must survive").toBe(1);
    expect(await count("mentor_payouts", "session_id", withC.sessionId), "another session's payout must survive").toBe(1);
  });
});
