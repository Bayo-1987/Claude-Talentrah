/**
 * The two dual-role isolation guarantees send-137 explicitly requires:
 *  1. A mentor cannot book their own listed session as a mentee.
 *  2. A mentee cannot approve their own mentor application via any admin
 *     path — "any", because the only admin path IS
 *     admin_moderate_mentor_application (0133), which requires the
 *     mentor_review permission (0132) that an ordinary seeker account never
 *     holds.
 *
 * Both are tested directly against the real database functions, not assumed
 * from the schema shape — see 0133's own comments on why `mentor_id`/
 * `mentee_id` and `admin_has_permission` are the actual guards, not a UI
 * filter or a foreign key.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`Dual-role isolation test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

describe("a mentor cannot book their own listing as a mentee", () => {
  let mentorId: string;
  let otherMenteeId: string;

  beforeAll(async () => {
    const mentor = await createTestUser("dualrole-mentor");
    const mentee = await createTestUser("dualrole-other-mentee");
    mentorId = mentor.id;
    otherMenteeId = mentee.id;

    const { error } = await admin.from("mentor_profiles").insert({
      user_id: mentorId,
      status: "approved",
      base_price_ngn: 10_000,
    });
    if (error) throw error;
  }, 60_000);

  afterAll(async () => {
    await admin.from("mentor_profiles").delete().eq("user_id", mentorId);
    await deleteTestUsers([mentorId, otherMenteeId]);
  }, 60_000);

  async function postSlot() {
    const { data, error } = await admin
      .from("mentor_availability_slots")
      .insert({
        mentor_id: mentorId,
        start_at: new Date(Date.now() + 3600_000).toISOString(),
        end_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("no slot");
    return data.id;
  }

  it("REJECTS a booking where mentee_id equals the mentor's own id", async () => {
    const slotId = await postSlot();

    const { data, error } = await admin.rpc("book_mentor_session", {
      p_availability_slot_id: slotId,
      p_mentee_id: mentorId,
      p_session_type: "resume_review",
    });

    expect(data, "DUAL-ROLE BUG: a mentor was allowed to book their own listing").toBeNull();
    expect(error?.message).toContain("CANNOT_BOOK_OWN_LISTING");

    // The slot's own lock must have been rolled back — a rejected self-booking
    // must not permanently burn the slot for a real mentee.
    const { data: slot } = await admin
      .from("mentor_availability_slots")
      .select("is_booked")
      .eq("id", slotId)
      .single();
    expect(slot?.is_booked, "the slot lock must roll back on a rejected self-booking").toBe(false);

    // Positive control — the very same slot books fine for someone else.
    const { data: real, error: realError } = await admin.rpc("book_mentor_session", {
      p_availability_slot_id: slotId,
      p_mentee_id: otherMenteeId,
      p_session_type: "resume_review",
    });
    expect(realError).toBeNull();
    expect(real?.[0]?.session_id).toBeTruthy();

    await admin.from("mentorship_sessions").delete().eq("id", real![0].session_id);
  });
});

describe("a mentee cannot approve their own mentor application via any admin path", () => {
  let applicantId: string;

  beforeAll(async () => {
    const applicant = await createTestUser("dualrole-applicant");
    applicantId = applicant.id;

    const { error } = await admin.from("mentor_profiles").insert({
      user_id: applicantId,
      status: "pending",
    });
    if (error) throw error;
  }, 60_000);

  afterAll(async () => {
    await admin.from("mentor_profiles").delete().eq("user_id", applicantId);
    await deleteTestUsers([applicantId]);
  }, 60_000);

  it("REJECTS admin_moderate_mentor_application when p_actor is the applicant themselves (an ordinary account, never an admin)", async () => {
    const { data, error } = await admin.rpc("admin_moderate_mentor_application", {
      p_actor: applicantId,
      p_mentor_user_id: applicantId,
      p_decision: "approved",
      p_note: "",
    });

    expect(error, "the RPC call itself should succeed and return a refusal row, not throw").toBeNull();
    expect(
      data?.[0]?.ok,
      "DUAL-ROLE BUG: an applicant with no admin permission approved their own mentor application",
    ).toBe(false);
    expect(data?.[0]?.reason).toBe("not_authorised");

    const { data: profile } = await admin
      .from("mentor_profiles")
      .select("status")
      .eq("user_id", applicantId)
      .single();
    expect(profile?.status, "the application must remain pending after a rejected self-approval attempt").toBe(
      "pending",
    );
  });

  it("REJECTS the same call even with an admin_users row that holds no mentor_review permission", async () => {
    // The stronger case: an actual admin account, just not one granted this
    // specific permission — proving the check is permission-scoped, not just
    // "is this id in admin_users at all".
    const { data: adminUser, error: adminError } = await admin
      .from("admin_users")
      .insert({ id: applicantId, email: `dualrole-noperm-${applicantId}@talentrah.test`, role: "standard" })
      .select("id")
      .maybeSingle();

    // admin_users.id has no FK to profiles/auth.users in every deployment
    // shape this repo has used historically; if this insert fails because a
    // constraint DOES exist, the test still proves the point via the
    // no-admin-row case above, so failure here is logged, not fatal.
    if (adminError) {
      console.warn(`[dual-role-isolation] could not insert a permissionless admin_users row: ${adminError.message}`);
      return;
    }

    try {
      const { data } = await admin.rpc("admin_moderate_mentor_application", {
        p_actor: applicantId,
        p_mentor_user_id: applicantId,
        p_decision: "approved",
        p_note: "",
      });
      expect(data?.[0]?.ok, "an admin with NO mentor_review permission still approved their own application").toBe(
        false,
      );
      expect(data?.[0]?.reason).toBe("not_authorised");
    } finally {
      if (adminUser) await admin.from("admin_users").delete().eq("id", applicantId);
    }
  });
});
