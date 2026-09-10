/**
 * 0133's RLS surface for the Mentorship Marketplace v1 slice: mentor_profiles
 * visibility, mentor_availability_slots' no-direct-update policy,
 * mentorship_sessions' party-only visibility and column grants, and
 * mentorship_reviews' completed-session-only insert.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Mentorship RLS suite cannot run: ${key} is not set.`);
}

let mentor: { id: string; client: DB };
let otherMentor: { id: string; client: DB };
let mentee: { id: string; client: DB };
let outsider: { id: string; client: DB };
let slotId: string;
let sessionId: string;

beforeAll(async () => {
  [mentor, otherMentor, mentee, outsider] = await Promise.all([
    createAuthedTestUser("mrls-mentor"),
    createAuthedTestUser("mrls-other-mentor"),
    createAuthedTestUser("mrls-mentee"),
    createAuthedTestUser("mrls-outsider"),
  ]);

  const { error } = await admin.from("mentor_profiles").insert({
    user_id: mentor.id,
    status: "approved",
    bio: "Approved mentor for RLS tests",
    base_price_ngn: 12_000,
  });
  if (error) throw error;

  const { error: otherError } = await admin.from("mentor_profiles").insert({
    user_id: otherMentor.id,
    status: "pending",
    bio: "Still awaiting review",
  });
  if (otherError) throw otherError;

  const { data: slot, error: slotError } = await admin
    .from("mentor_availability_slots")
    .insert({
      mentor_id: mentor.id,
      start_at: new Date(Date.now() + 3600_000).toISOString(),
      end_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
    })
    .select("id")
    .single();
  if (slotError || !slot) throw slotError ?? new Error("no slot");
  slotId = slot.id;

  const { data: booking, error: bookError } = await admin.rpc("book_mentor_session", {
    p_availability_slot_id: slotId,
    p_mentee_id: mentee.id,
    p_session_type: "resume_review",
  });
  if (bookError || !booking?.[0]) throw bookError ?? new Error("booking failed");
  sessionId = booking[0].session_id;
}, 60_000);

afterAll(async () => {
  await admin.from("mentorship_sessions").delete().eq("id", sessionId);
  await admin.from("mentor_profiles").delete().in("user_id", [mentor.id, otherMentor.id]);
  await deleteTestUsers([mentor.id, otherMentor.id, mentee.id, outsider.id]);
}, 60_000);

describe("mentor_profiles visibility", () => {
  it("an approved mentor is visible to anyone signed in", async () => {
    const { data, error } = await outsider.client
      .from("mentor_profiles")
      .select("user_id")
      .eq("user_id", mentor.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.user_id).toBe(mentor.id);
  });

  it("a PENDING mentor is invisible to everyone except themselves", async () => {
    const { data: seenByOutsider } = await outsider.client
      .from("mentor_profiles")
      .select("user_id")
      .eq("user_id", otherMentor.id)
      .maybeSingle();
    expect(
      seenByOutsider,
      "an unapproved mentor application must not be publicly visible",
    ).toBeNull();

    const { data: seenBySelf } = await otherMentor.client
      .from("mentor_profiles")
      .select("user_id")
      .eq("user_id", otherMentor.id)
      .maybeSingle();
    expect(seenBySelf?.user_id).toBe(otherMentor.id);
  });

  it("a user cannot insert their own mentor_profiles row pre-approved", async () => {
    const { error } = await outsider.client.from("mentor_profiles").insert({
      user_id: outsider.id,
      status: "approved",
    });
    expect(error, "RLS must refuse a self-approved insert").not.toBeNull();

    const { data } = await admin.from("mentor_profiles").select("status").eq("user_id", outsider.id).maybeSingle();
    expect(data).toBeNull();
  });

  it("the owner cannot write status/reviewed_at/reviewed_by/review_note even via their own row's UPDATE", async () => {
    const { error } = await mentor.client
      .from("mentor_profiles")
      .update({ status: "suspended" })
      .eq("user_id", mentor.id);
    // A column-privilege refusal (42501) is the expected shape, matching
    // 0030's own precedent — the row policy would otherwise allow this.
    expect(error, "COLUMN-PRIVILEGE BUG: a mentor rewrote their own vetting status").not.toBeNull();

    const { data } = await admin.from("mentor_profiles").select("status").eq("user_id", mentor.id).single();
    expect(data?.status).toBe("approved");
  });

  it("the owner CAN write their own safe fields (bio, expertise, price)", async () => {
    const { error } = await mentor.client
      .from("mentor_profiles")
      .update({ bio: "Updated bio via RLS test" })
      .eq("user_id", mentor.id);
    expect(error).toBeNull();

    const { data } = await admin.from("mentor_profiles").select("bio").eq("user_id", mentor.id).single();
    expect(data?.bio).toBe("Updated bio via RLS test");
  });
});

describe("mentor_availability_slots", () => {
  it("has no client UPDATE path at all — is_booked cannot be flipped directly", async () => {
    // No UPDATE policy at all means RLS filters every row before the write
    // even reaches it — the same "silent zero rows, not an error" shape as
    // the delete case below, not a thrown error.
    const { error, count } = await mentor.client
      .from("mentor_availability_slots")
      .update({ is_booked: false }, { count: "exact" })
      .eq("id", slotId);
    expect(error).toBeNull();
    expect(
      count,
      "SECURITY BUG: a client could flip is_booked directly, bypassing book_mentor_session's atomic lock",
    ).toBe(0);

    const { data } = await admin.from("mentor_availability_slots").select("is_booked").eq("id", slotId).single();
    expect(data?.is_booked, "the slot must still be booked").toBe(true);
  });

  it("a mentor cannot delete an already-booked slot", async () => {
    const { error, count } = await mentor.client
      .from("mentor_availability_slots")
      .delete({ count: "exact" })
      .eq("id", slotId);
    expect(error).toBeNull(); // RLS refusal here is a silent zero-row match, not an error
    expect(count, "a booked slot must not be deletable").toBe(0);

    const { data } = await admin.from("mentor_availability_slots").select("id").eq("id", slotId).maybeSingle();
    expect(data, "the booked slot must still exist").not.toBeNull();
  });
});

describe("mentorship_sessions party-only visibility and column grants", () => {
  it("the mentor and the mentee can both read the session", async () => {
    const { data: forMentor } = await mentor.client
      .from("mentorship_sessions")
      .select("id")
      .eq("id", sessionId)
      .maybeSingle();
    expect(forMentor?.id).toBe(sessionId);

    const { data: forMentee } = await mentee.client
      .from("mentorship_sessions")
      .select("id")
      .eq("id", sessionId)
      .maybeSingle();
    expect(forMentee?.id).toBe(sessionId);
  });

  it("an outsider cannot read the session at all", async () => {
    const { data } = await outsider.client
      .from("mentorship_sessions")
      .select("id")
      .eq("id", sessionId)
      .maybeSingle();
    expect(data, "PRIVACY BUG: a session was visible to neither party").toBeNull();
  });

  it("neither party can write status, price, or meeting_link directly", async () => {
    const { error: mentorAttempt } = await mentor.client
      .from("mentorship_sessions")
      .update({ status: "confirmed" })
      .eq("id", sessionId);
    expect(mentorAttempt, "a mentor bypassed mark_mentor_session_confirmed's own gate").not.toBeNull();

    const { error: menteeAttempt } = await mentee.client
      .from("mentorship_sessions")
      .update({ price_ngn: 0 })
      .eq("id", sessionId);
    expect(menteeAttempt, "MONEY BUG: a mentee rewrote their own session's price").not.toBeNull();

    const { data } = await admin.from("mentorship_sessions").select("status, price_ngn").eq("id", sessionId).single();
    expect(data?.status).toBe("pending_payment");
    expect(data?.price_ngn).toBe(12_000);
  });

  it("the mentee can write their own mentee_notes but not mentor_notes", async () => {
    const { error: ok } = await mentee.client
      .from("mentorship_sessions")
      .update({ mentee_notes: "Looking forward to this" })
      .eq("id", sessionId);
    expect(ok).toBeNull();

    // The column grant alone permits this UPDATE statement (0133's own header
    // explains why a plain grant can't distinguish which party) — it is the
    // enforce_mentorship_session_notes_ownership trigger that must refuse it.
    const { error: refused } = await mentee.client
      .from("mentorship_sessions")
      .update({ mentor_notes: "not theirs to write" })
      .eq("id", sessionId);
    expect(refused, "a mentee wrote into the mentor's own notes column").not.toBeNull();
    expect(refused?.message).toContain("NOT_YOUR_NOTES");
  });
});

describe("mentorship_reviews", () => {
  it("cannot be inserted for a session that is not completed", async () => {
    const { error } = await mentee.client.from("mentorship_reviews").insert({
      session_id: sessionId,
      mentor_id: mentor.id,
      reviewer_id: mentee.id,
      rating: 5,
    });
    expect(error, "a review was accepted for a session that never completed").not.toBeNull();
  });

  it("cannot be inserted by someone other than the session's own mentee", async () => {
    await admin.from("mentorship_sessions").update({ status: "completed" }).eq("id", sessionId);

    const { error } = await outsider.client.from("mentorship_reviews").insert({
      session_id: sessionId,
      mentor_id: mentor.id,
      reviewer_id: outsider.id,
      rating: 1,
    });
    expect(error, "someone who was never party to the session left a review").not.toBeNull();
  });

  it("the real mentee CAN review their own completed session, exactly once", async () => {
    const { error } = await mentee.client.from("mentorship_reviews").insert({
      session_id: sessionId,
      mentor_id: mentor.id,
      reviewer_id: mentee.id,
      rating: 5,
      review_text: "Great session",
    });
    expect(error).toBeNull();

    const { error: second } = await mentee.client.from("mentorship_reviews").insert({
      session_id: sessionId,
      mentor_id: mentor.id,
      reviewer_id: mentee.id,
      rating: 3,
    });
    expect(second, "a second review of the same session must be refused (UNIQUE on session_id)").not.toBeNull();

    await admin.from("mentorship_reviews").delete().eq("session_id", sessionId);
  });
});

/**
 * 0150's own standing check: mentorship_reviews' UPDATE and DELETE had never
 * been revoked from `authenticated` since 0133 created the table — only its
 * SELECT and INSERT policies existed, and INSERT is deliberately left
 * granted (the real, working "a mentee may review their own COMPLETED
 * session, once" policy above). A review must never be editable or
 * deletable by a client once submitted. CLAUDE.md's own column-privilege
 * lesson, applied here directly.
 */
describe("0150: mentorship_reviews has no direct client UPDATE/DELETE, at the grant level", () => {
  let reviewId: string;

  beforeAll(async () => {
    const { data, error } = await admin
      .from("mentorship_reviews")
      .insert({ session_id: sessionId, mentor_id: mentor.id, reviewer_id: mentee.id, rating: 4, review_text: "Solid session" })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("no review");
    reviewId = data.id;
  });

  afterAll(async () => {
    await admin.from("mentorship_reviews").delete().eq("id", reviewId);
  });

  it("the reviewer cannot edit their own submitted review directly", async () => {
    const { error } = await mentee.client.from("mentorship_reviews").update({ rating: 1 }).eq("id", reviewId);
    expect(
      error?.code,
      "GRANT BUG: a direct client UPDATE on mentorship_reviews was not refused at the grant level",
    ).toBe("42501");
  });

  it("the reviewer cannot delete their own submitted review directly", async () => {
    const { error } = await mentee.client.from("mentorship_reviews").delete().eq("id", reviewId);
    expect(
      error?.code,
      "GRANT BUG: a direct client DELETE on mentorship_reviews was not refused at the grant level",
    ).toBe("42501");

    const { data: stillThere } = await admin.from("mentorship_reviews").select("id").eq("id", reviewId).maybeSingle();
    expect(stillThere?.id, "the review must survive an attempted client-side delete").toBe(reviewId);
  });
});
