/**
 * send-502 / S15 — the 30-minute hold, in SQL: the booking RPC, the open-slot read, and the daily sweep.
 *
 * The hold has to work without the sweep (Vercel Hobby crons run at most daily), so these assert it at read and booking time.
 * The 29:59 / 30:01 boundary is asserted DETERMINISTICALLY through the `p_now` parameter of open_mentor_slots and
 * expire_unpaid_mentor_sessions (created_at is fixed, the clock is passed in). book_mentor_session reads the real clock, so it
 * is tested a margin either side of the boundary (29 and 31 minutes) rather than flakily at the second.
 * The same scenarios were run by hand against a real Postgres inside a rolled-back transaction; see the PR body.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`unpaid-hold-booking test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const HOUR = 3_600_000;
const MIN = 60_000;
let mentorId: string;
let menteeId: string;
let strangerId: string;
const slotIds: string[] = [];

beforeAll(async () => {
  const [mentor, mentee, stranger] = await Promise.all([createTestUser("hold-mentor"), createTestUser("hold-mentee"), createTestUser("hold-stranger")]);
  mentorId = mentor.id;
  menteeId = mentee.id;
  strangerId = stranger.id;
  const { error } = await admin.from("mentor_profiles").upsert({ user_id: mentorId, status: "approved", self_paused: false, base_price_ngn: 20_000 });
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await admin.from("mentor_profiles").delete().eq("user_id", mentorId);
  await deleteTestUsers([mentorId, menteeId, strangerId]);
}, 60_000);

afterEach(async () => {
  await admin.from("mentor_profiles").update({ status: "approved", self_paused: false, base_price_ngn: 20_000 }).eq("user_id", mentorId);
  if (slotIds.length) {
    const ids = slotIds.splice(0);
    const { error: e1 } = await admin.from("mentorship_sessions").delete().in("availability_slot_id", ids);
    if (e1) throw new Error(`session cleanup: ${e1.message}`);
    const { error: e2 } = await admin.from("mentor_availability_slots").delete().in("id", ids);
    if (e2) throw new Error(`slot cleanup: ${e2.message}`);
  }
});

async function freeSlot(daysAhead = 3): Promise<string> {
  const start = Date.now() + daysAhead * 24 * HOUR;
  const { data, error } = await admin
    .from("mentor_availability_slots")
    .insert({ mentor_id: mentorId, start_at: new Date(start).toISOString(), end_at: new Date(start + HOUR).toISOString() })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no slot");
  slotIds.push(data.id);
  return data.id;
}

const book = (slotId: string, mentee: string) =>
  admin.rpc("book_mentor_session", { p_availability_slot_id: slotId, p_mentee_id: mentee, p_session_type: "mock_interview" });

/** Book as `menteeId`, then backdate the booking to `createdAt`. */
async function heldSlot(createdAt: Date) {
  const slot = await freeSlot();
  const booked = await book(slot, menteeId);
  expect(booked.error).toBeNull();
  const sessionId = booked.data![0].session_id;
  const { error } = await admin.from("mentorship_sessions").update({ created_at: createdAt.toISOString() }).eq("id", sessionId);
  expect(error).toBeNull();
  return { slot, sessionId };
}

const openIds = async (at?: Date) => {
  const { data, error } = await admin.rpc("open_mentor_slots", { p_mentor_ids: [mentorId], ...(at ? { p_now: at.toISOString() } : {}) });
  expect(error).toBeNull();
  return (data ?? []).map((r) => r.id);
};
const statusOf = async (id: string) => (await admin.from("mentorship_sessions").select("status").eq("id", id).single()).data?.status;

describe("open_mentor_slots: one definition of open", () => {
  it("lists an unbooked future slot", async () => {
    const slot = await freeSlot();
    expect(await openIds()).toContain(slot);
  });

  it("does not list a slot held by an unpaid booking at 29:59, lists it at 30:00 and at 30:01", async () => {
    const created = new Date(Date.now() - 2 * HOUR);
    const { slot } = await heldSlot(created);
    expect(await openIds(new Date(created.getTime() + 29 * MIN + 59_000)), "29:59: still held").not.toContain(slot);
    expect(await openIds(new Date(created.getTime() + 30 * MIN)), "30:00: lapsed (created_at <= now - hold)").toContain(slot);
    expect(await openIds(new Date(created.getTime() + 30 * MIN + 1_000)), "30:01: lapsed").toContain(slot);
  });

  it("never lists a slot held by a PAID booking, however old", async () => {
    const { slot, sessionId } = await heldSlot(new Date(Date.now() - 5 * HOUR));
    await admin.from("mentorship_sessions").update({ status: "awaiting_confirmation" }).eq("id", sessionId);
    expect(await openIds()).not.toContain(slot);
  });

  it("never lists a past slot, a paused mentor's slots, or an unapproved mentor's slots", async () => {
    const past = await freeSlot(-2);
    expect(await openIds()).not.toContain(past);
    const slot = await freeSlot();
    await admin.from("mentor_profiles").update({ self_paused: true }).eq("user_id", mentorId);
    expect(await openIds()).not.toContain(slot);
    await admin.from("mentor_profiles").update({ self_paused: false, status: "suspended" }).eq("user_id", mentorId);
    expect(await openIds()).not.toContain(slot);
  });
});

describe("book_mentor_session and a held slot", () => {
  it("refuses a slot whose unpaid hold is still running (29 minutes in)", async () => {
    const { slot, sessionId } = await heldSlot(new Date(Date.now() - 29 * MIN));
    const stranger = await book(slot, strangerId);
    expect(stranger.error?.message).toContain("SLOT_UNAVAILABLE");
    expect(await statusOf(sessionId)).toBe("pending_payment");
  });

  it("takes a slot whose hold has lapsed (31 minutes in), expiring the old booking in the same call", async () => {
    const { slot, sessionId } = await heldSlot(new Date(Date.now() - 31 * MIN));
    const stranger = await book(slot, strangerId);
    expect(stranger.error).toBeNull();
    expect(await statusOf(sessionId)).toBe("expired_unpaid");
    expect(await openIds()).not.toContain(slot);
  });

  it("lets the same mentee re-book their own lapsed slot", async () => {
    const { slot, sessionId } = await heldSlot(new Date(Date.now() - 45 * MIN));
    const again = await book(slot, menteeId);
    expect(again.error).toBeNull();
    expect(again.data![0].session_id).not.toBe(sessionId);
  });

  it("a free (volunteer) mentor's booking never holds a slot unpaid", async () => {
    await admin.from("mentor_profiles").update({ base_price_ngn: null }).eq("user_id", mentorId);
    const slot = await freeSlot();
    const booked = await book(slot, menteeId);
    expect(booked.error).toBeNull();
    expect(await statusOf(booked.data![0].session_id)).toBe("awaiting_confirmation");
    expect(await openIds()).not.toContain(slot);
  });
});

describe("the daily sweep only tidies what the hold already released", () => {
  it("expires a lapsed hold (30:01) and releases its slot, and leaves a running one (29:59) alone", async () => {
    const created = new Date(Date.now() - 3 * HOUR);
    const lapsed = await heldSlot(created);
    const running = await heldSlot(created);
    // Evaluate at created + 29:59 first: nothing of these may be touched.
    const early = await admin.rpc("expire_unpaid_mentor_sessions", { p_now: new Date(created.getTime() + 29 * MIN + 59_000).toISOString() });
    expect(early.error).toBeNull();
    expect((early.data ?? []).map((r) => r.session_id)).not.toContain(lapsed.sessionId);
    expect(await statusOf(lapsed.sessionId)).toBe("pending_payment");

    // At 30:01 both are lapsed; make one of them younger so it is NOT.
    await admin.from("mentorship_sessions").update({ created_at: new Date(created.getTime() + 10 * MIN).toISOString() }).eq("id", running.sessionId);
    const late = await admin.rpc("expire_unpaid_mentor_sessions", { p_now: new Date(created.getTime() + 30 * MIN + 1_000).toISOString() });
    expect(late.error).toBeNull();
    const ids = (late.data ?? []).map((r) => r.session_id);
    expect(ids).toContain(lapsed.sessionId);
    expect(ids).not.toContain(running.sessionId);
    expect(await statusOf(lapsed.sessionId)).toBe("expired_unpaid");
    expect((await admin.from("mentor_availability_slots").select("is_booked").eq("id", lapsed.slot).single()).data?.is_booked).toBe(false);
    expect((await admin.from("mentor_availability_slots").select("is_booked").eq("id", running.slot).single()).data?.is_booked).toBe(true);
  });
});
