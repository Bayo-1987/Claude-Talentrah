/**
 * send-502 / S15 — two bookings racing for the same slot: exactly one wins.
 *
 * This is the regression that matters most in 0203. The migration replaces `UNIQUE (availability_slot_id)` with a partial
 * unique index and makes book_mentor_session release a lapsed unpaid hold in the same statement that books the slot. If either
 * change let a second booking through, two mentees would be sold the same hour of one mentor's time.
 *
 * Real database, real concurrency: each race fires its RPC calls together with Promise.all over separate requests, so they
 * hit Postgres as concurrent transactions. Repeated, because a race that passes once proves little.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`book-session-race test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const HOUR = 3_600_000;
const LIVE = ["pending_payment", "awaiting_confirmation", "confirmed", "completed"];
let mentorId: string;
let menteeIds: string[];
const slotIds: string[] = [];

beforeAll(async () => {
  const users = await Promise.all(["race-mentor", "race-a", "race-b", "race-c"].map((p) => createTestUser(p)));
  mentorId = users[0].id;
  menteeIds = users.slice(1).map((u) => u.id);
  const { error } = await admin.from("mentor_profiles").upsert({ user_id: mentorId, status: "approved", base_price_ngn: 20_000 });
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await admin.from("mentor_profiles").delete().eq("user_id", mentorId);
  await deleteTestUsers([mentorId, ...menteeIds]);
}, 60_000);

afterEach(async () => {
  if (slotIds.length) {
    const ids = slotIds.splice(0);
    const { error: e1 } = await admin.from("mentorship_sessions").delete().in("availability_slot_id", ids);
    if (e1) throw new Error(`session cleanup: ${e1.message}`);
    const { error: e2 } = await admin.from("mentor_availability_slots").delete().in("id", ids);
    if (e2) throw new Error(`slot cleanup: ${e2.message}`);
  }
});

async function freeSlot(): Promise<string> {
  const { data, error } = await admin
    .from("mentor_availability_slots")
    .insert({ mentor_id: mentorId, start_at: new Date(Date.now() + 48 * HOUR).toISOString(), end_at: new Date(Date.now() + 49 * HOUR).toISOString() })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no slot");
  slotIds.push(data.id);
  return data.id;
}

const book = (slotId: string, mentee: string) =>
  admin.rpc("book_mentor_session", { p_availability_slot_id: slotId, p_mentee_id: mentee, p_session_type: "mock_interview" });

async function liveSessions(slotId: string) {
  const { data, error } = await admin.from("mentorship_sessions").select("id, mentee_id, status").eq("availability_slot_id", slotId);
  if (error) throw error;
  return (data ?? []).filter((s) => LIVE.includes(s.status));
}

function outcomes(results: Array<{ error: { message: string } | null }>) {
  return { wins: results.filter((r) => !r.error).length, refusals: results.filter((r) => r.error?.message.includes("SLOT_UNAVAILABLE")).length };
}

describe("two bookings racing for the same FREE slot", () => {
  it("exactly one wins, the other is told the slot is unavailable, and one live session exists (x10)", async () => {
    for (let i = 0; i < 10; i++) {
      const slot = await freeSlot();
      const results = await Promise.all([book(slot, menteeIds[0]), book(slot, menteeIds[1])]);
      expect(outcomes(results), `round ${i}`).toEqual({ wins: 1, refusals: 1 });
      expect(await liveSessions(slot), `round ${i}`).toHaveLength(1);
    }
  }, 120_000);

  it("three racers: still exactly one winner", async () => {
    for (let i = 0; i < 5; i++) {
      const slot = await freeSlot();
      const results = await Promise.all(menteeIds.map((m) => book(slot, m)));
      expect(outcomes(results), `round ${i}`).toEqual({ wins: 1, refusals: 2 });
      expect(await liveSessions(slot)).toHaveLength(1);
    }
  }, 120_000);

  it("one mentee double-clicking races themselves: still one booking", async () => {
    const slot = await freeSlot();
    const results = await Promise.all([book(slot, menteeIds[0]), book(slot, menteeIds[0])]);
    expect(outcomes(results)).toEqual({ wins: 1, refusals: 1 });
    expect(await liveSessions(slot)).toHaveLength(1);
  });
});

describe("two bookings racing for a slot whose unpaid hold has LAPSED", () => {
  it("exactly one takes it; the lapsed booking is expired exactly once; one live session exists (x10)", async () => {
    for (let i = 0; i < 10; i++) {
      const slot = await freeSlot();
      const first = await book(slot, menteeIds[2]);
      expect(first.error).toBeNull();
      const firstId = first.data![0].session_id;
      const { error } = await admin.from("mentorship_sessions").update({ created_at: new Date(Date.now() - 45 * 60_000).toISOString() }).eq("id", firstId);
      expect(error).toBeNull();

      const results = await Promise.all([book(slot, menteeIds[0]), book(slot, menteeIds[1])]);
      expect(outcomes(results), `round ${i}`).toEqual({ wins: 1, refusals: 1 });

      const live = await liveSessions(slot);
      expect(live, `round ${i}: exactly one live session`).toHaveLength(1);
      expect(live[0].id).not.toBe(firstId);
      const { data: old } = await admin.from("mentorship_sessions").select("status").eq("id", firstId).single();
      expect(old?.status).toBe("expired_unpaid");
    }
  }, 180_000);

  it("a hold still running (well inside 30 minutes) is never taken, even by a race", async () => {
    const slot = await freeSlot();
    const first = await book(slot, menteeIds[2]);
    expect(first.error).toBeNull();
    await admin.from("mentorship_sessions").update({ created_at: new Date(Date.now() - 20 * 60_000).toISOString() }).eq("id", first.data![0].session_id);
    const results = await Promise.all([book(slot, menteeIds[0]), book(slot, menteeIds[1])]);
    expect(outcomes(results)).toEqual({ wins: 0, refusals: 2 });
    const live = await liveSessions(slot);
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(first.data![0].session_id);
  });
});
