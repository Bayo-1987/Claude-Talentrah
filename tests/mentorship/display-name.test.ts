/**
 * send-418 — a real, mentor-settable display_name on mentor_profiles,
 * decoupled from profiles.first_name/last_name (the onboarding-signup
 * name, which for two of production's mentor accounts turned out to be a
 * company/account name — "Zimcrest Technologies", "Info Talentrah" — not a
 * person's name; see src/lib/mentorship/name-validation.ts's own header).
 *
 * mentor_public_names() (0167/0174) and mentorship_session_counterparty_names()
 * (0168) both now return a nullable display_name column
 * (0184_mentor_display_name.sql). This proves both halves of the contract
 * against the real database: display_name wins when a mentor has set one,
 * and the existing first_name/last_name resolution is completely unaffected
 * for every mentor who hasn't — the fallback path this migration must not
 * silently break for every already-correctly-named mentor.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`display-name suite cannot run: ${key} is not set.`);
}

let mentorWithDisplayName: { id: string; client: DB };
let mentorWithoutDisplayName: { id: string; client: DB };
let mentee: { id: string; client: DB };
let outsider: { id: string; client: DB };
let sessionId: string;
let slotId: string;

beforeAll(async () => {
  [mentorWithDisplayName, mentorWithoutDisplayName, mentee, outsider] = await Promise.all([
    createAuthedTestUser("dispname-set"),
    createAuthedTestUser("dispname-unset"),
    createAuthedTestUser("dispname-mentee"),
    createAuthedTestUser("dispname-outsider"),
  ]);

  await admin.from("profiles").update({ first_name: "Onboarding", last_name: "NameOne" }).eq("id", mentorWithDisplayName.id);
  await admin.from("profiles").update({ first_name: "Onboarding", last_name: "NameTwo" }).eq("id", mentorWithoutDisplayName.id);

  const { error: mentorError } = await admin.from("mentor_profiles").insert([
    {
      user_id: mentorWithDisplayName.id,
      status: "approved",
      display_name: "Real Chosen Name",
      bio: "fixture — has set a display name",
    },
    {
      user_id: mentorWithoutDisplayName.id,
      status: "approved",
      display_name: null,
      bio: "fixture — has not set a display name",
    },
  ]);
  if (mentorError) throw new Error(`fixture mentor_profiles: ${mentorError.message}`);

  // A real booked session between mentorWithDisplayName and mentee, so
  // mentorship_session_counterparty_names() has a real row to resolve —
  // mentorship_sessions requires a unique availability_slot_id and a
  // commission split that sums to price_ngn (0133's own CHECK constraint).
  const { data: slot, error: slotError } = await admin
    .from("mentor_availability_slots")
    .insert({
      mentor_id: mentorWithDisplayName.id,
      start_at: new Date(Date.now() + 3600_000).toISOString(),
      end_at: new Date(Date.now() + 7200_000).toISOString(),
      is_booked: true,
    })
    .select("id")
    .single();
  if (slotError || !slot) throw new Error(`fixture mentor_availability_slots: ${slotError?.message}`);
  slotId = slot.id;

  const { data: session, error: sessionError } = await admin
    .from("mentorship_sessions")
    .insert({
      mentor_id: mentorWithDisplayName.id,
      mentee_id: mentee.id,
      availability_slot_id: slotId,
      session_type: "mock_interview",
      scheduled_start: new Date(Date.now() + 3600_000).toISOString(),
      scheduled_end: new Date(Date.now() + 7200_000).toISOString(),
      price_ngn: 10_000,
      platform_commission_ngn: 1_500,
      mentor_payout_ngn: 8_500,
      status: "confirmed",
    })
    .select("id")
    .single();
  if (sessionError || !session) throw new Error(`fixture mentorship_sessions: ${sessionError?.message}`);
  sessionId = session.id;
}, 60_000);

afterAll(async () => {
  await admin.from("mentorship_sessions").delete().eq("id", sessionId);
  await admin.from("mentor_availability_slots").delete().eq("id", slotId);
  await admin.from("mentor_profiles").delete().in("user_id", [mentorWithDisplayName.id, mentorWithoutDisplayName.id]);
  await deleteTestUsers([mentorWithDisplayName.id, mentorWithoutDisplayName.id, mentee.id, outsider.id]);
}, 60_000);

describe("mentor_public_names() display_name preference", () => {
  it("returns the mentor's display_name when they've set one", async () => {
    const { data, error } = await outsider.client.rpc("mentor_public_names", {
      p_mentor_ids: [mentorWithDisplayName.id],
    });
    expect(error).toBeNull();
    expect(data?.[0]?.display_name).toBe("Real Chosen Name");
  });

  it("REGRESSION: still returns first_name/last_name unchanged when display_name is null — the fallback path every already-correct mentor relies on", async () => {
    const { data, error } = await outsider.client.rpc("mentor_public_names", {
      p_mentor_ids: [mentorWithoutDisplayName.id],
    });
    expect(error).toBeNull();
    expect(data?.[0]?.display_name).toBeNull();
    expect(data?.[0]?.first_name).toBe("Onboarding");
    expect(data?.[0]?.last_name).toBe("NameTwo");
  });
});

describe("mentorship_session_counterparty_names() display_name preference", () => {
  it("returns the mentor counterparty's display_name to their mentee, when set", async () => {
    const { data, error } = await mentee.client.rpc("mentorship_session_counterparty_names", {
      p_user_ids: [mentorWithDisplayName.id],
    });
    expect(error).toBeNull();
    expect(data?.[0]?.display_name).toBe("Real Chosen Name");
  });

  it("REGRESSION: returns null display_name (not an error) for a mentee counterparty, who never has a mentor_profiles row", async () => {
    const { data, error } = await mentorWithDisplayName.client.rpc("mentorship_session_counterparty_names", {
      p_user_ids: [mentee.id],
    });
    expect(error).toBeNull();
    expect(data?.[0]?.display_name).toBeNull();
  });
});
