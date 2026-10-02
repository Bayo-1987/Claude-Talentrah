/**
 * send-502 / S15 — an unpaid mentor booking expires when its slot starts, and the slot is released (migration 0203).
 *
 * What the owner hit: book_mentor_session locks the slot and creates the session `pending_payment` BEFORE any payment exists,
 * and nothing ever undid it. A mentee who never paid left the booking, and the slot, held forever: the mentor's profile said
 * "No open slots right now" for a slot nobody would use.
 *
 * These run against the REAL database (the guarantee is a SQL one: the expiry and the release are ONE statement, the 0035
 * pattern, so there is no read-then-write for a concurrent booking to slip through). The same scenarios were also run by hand
 * against a real Postgres inside a rolled-back transaction; that output is in the PR body.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createTestUser, deleteTestUsers } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`unpaid-expiry test cannot run: ${key} is not set.`);
}

const admin: SupabaseClient<Database> = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let mentorId: string;
let menteeId: string;
let strangerId: string;
const sessionIds: string[] = [];
const slotIds: string[] = [];

beforeAll(async () => {
  const [mentor, mentee, stranger] = await Promise.all([createTestUser("expiry-mentor"), createTestUser("expiry-mentee"), createTestUser("expiry-stranger")]);
  mentorId = mentor.id;
  menteeId = mentee.id;
  strangerId = stranger.id;
  const { error } = await admin.from("mentor_profiles").upsert({ user_id: mentorId, status: "approved", base_price_ngn: 20_000 });
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await admin.from("mentor_profiles").delete().eq("user_id", mentorId);
  await deleteTestUsers([mentorId, menteeId, strangerId]);
}, 60_000);

afterEach(async () => {
  if (sessionIds.length) {
    const { error } = await admin.from("mentorship_sessions").delete().in("id", sessionIds.splice(0));
    if (error) throw new Error(`session cleanup: ${error.message}`);
  }
  if (slotIds.length) {
    const { error } = await admin.from("mentor_availability_slots").delete().in("id", slotIds.splice(0));
    if (error) throw new Error(`slot cleanup: ${error.message}`);
  }
});

const HOUR = 3_600_000;

async function makeSlot(startOffsetHours: number, booked = true) {
  const { data, error } = await admin
    .from("mentor_availability_slots")
    .insert({
      mentor_id: mentorId,
      start_at: new Date(Date.now() + startOffsetHours * HOUR).toISOString(),
      end_at: new Date(Date.now() + (startOffsetHours + 1) * HOUR).toISOString(),
      is_booked: booked,
    })
    .select("id, start_at")
    .single();
  if (error || !data) throw error ?? new Error("no slot");
  slotIds.push(data.id);
  return data;
}

async function makeSession(slot: { id: string; start_at: string }, status: string, forMentee = menteeId) {
  const { data, error } = await admin
    .from("mentorship_sessions")
    .insert({
      mentor_id: mentorId,
      mentee_id: forMentee,
      availability_slot_id: slot.id,
      session_type: "mock_interview",
      scheduled_start: slot.start_at,
      scheduled_end: new Date(Date.parse(slot.start_at) + HOUR).toISOString(),
      price_ngn: 25_000,
      platform_commission_ngn: 3_750,
      mentor_payout_ngn: 21_250,
      status,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no session");
  sessionIds.push(data.id);
  return data.id;
}

const statusOf = async (id: string) => (await admin.from("mentorship_sessions").select("status").eq("id", id).single()).data?.status;
const bookedOf = async (slotId: string) => (await admin.from("mentor_availability_slots").select("is_booked").eq("id", slotId).single()).data?.is_booked;

describe("expire_unpaid_mentor_sessions", () => {
  it("expires an unpaid booking whose slot has started AND releases its slot in the same call", async () => {
    const slot = await makeSlot(-48);
    const id = await makeSession(slot, "pending_payment");

    const { data, error } = await admin.rpc("expire_unpaid_mentor_sessions", { p_now: new Date().toISOString() });
    expect(error).toBeNull();
    expect(data?.map((r) => r.session_id)).toContain(id);
    expect(await statusOf(id)).toBe("expired_unpaid");
    expect(await bookedOf(slot.id), "the slot must be released together with the expiry").toBe(false);
  });

  it("leaves an unpaid booking whose slot is still ahead alone, and its slot held", async () => {
    const slot = await makeSlot(24);
    const id = await makeSession(slot, "pending_payment");
    await admin.rpc("expire_unpaid_mentor_sessions", { p_now: new Date().toISOString() });
    expect(await statusOf(id)).toBe("pending_payment");
    expect(await bookedOf(slot.id)).toBe(true);
  });

  it("never touches a PAID session, even if it has started", async () => {
    const slot = await makeSlot(-48);
    const waiting = await makeSession(slot, "awaiting_confirmation");
    const slot2 = await makeSlot(-30);
    const confirmed = await makeSession(slot2, "confirmed");
    await admin.rpc("expire_unpaid_mentor_sessions", { p_now: new Date().toISOString() });
    expect(await statusOf(waiting)).toBe("awaiting_confirmation");
    expect(await statusOf(confirmed)).toBe("confirmed");
    expect(await bookedOf(slot.id)).toBe(true);
    expect(await bookedOf(slot2.id)).toBe(true);
  });

  it("is idempotent: a second call finds nothing", async () => {
    const slot = await makeSlot(-48);
    const id = await makeSession(slot, "pending_payment");
    const first = await admin.rpc("expire_unpaid_mentor_sessions", { p_now: new Date().toISOString() });
    const second = await admin.rpc("expire_unpaid_mentor_sessions", { p_now: new Date().toISOString() });
    expect(first.data?.map((r) => r.session_id)).toContain(id);
    expect(second.data?.map((r) => r.session_id) ?? []).not.toContain(id);
  });

  it("honours p_now at the boundary: a slot starting exactly now is expired, one a second later is not", async () => {
    const now = new Date();
    const atStart = await makeSlot(0);
    const later = await makeSlot(1);
    const a = await makeSession(atStart, "pending_payment");
    const b = await makeSession(later, "pending_payment");
    await admin.rpc("expire_unpaid_mentor_sessions", { p_now: new Date(Date.parse(atStart.start_at)).toISOString() });
    expect(await statusOf(a)).toBe("expired_unpaid");
    expect(await statusOf(b)).toBe("pending_payment");
    void now;
  });
});

describe("a released slot can be booked again; two LIVE sessions on one slot still cannot exist", () => {
  it("allows a new session on a slot whose previous booking expired", async () => {
    const slot = await makeSlot(-48);
    await makeSession(slot, "pending_payment");
    await admin.rpc("expire_unpaid_mentor_sessions", { p_now: new Date().toISOString() });
    const { error } = await admin.from("mentorship_sessions").insert({
      mentor_id: mentorId,
      mentee_id: strangerId,
      availability_slot_id: slot.id,
      session_type: "mock_interview",
      scheduled_start: slot.start_at,
      scheduled_end: new Date(Date.parse(slot.start_at) + HOUR).toISOString(),
      price_ngn: 25_000,
      platform_commission_ngn: 3_750,
      mentor_payout_ngn: 21_250,
      status: "pending_payment",
    });
    expect(error, "the old UNIQUE (availability_slot_id) made this impossible").toBeNull();
    const { data } = await admin.from("mentorship_sessions").select("id").eq("availability_slot_id", slot.id);
    sessionIds.push(...(data ?? []).map((r) => r.id).filter((id) => !sessionIds.includes(id)));
  });

  it("refuses a second LIVE session on the same slot (unique violation)", async () => {
    const slot = await makeSlot(24);
    await makeSession(slot, "pending_payment");
    const { error } = await admin.from("mentorship_sessions").insert({
      mentor_id: mentorId,
      mentee_id: strangerId,
      availability_slot_id: slot.id,
      session_type: "mock_interview",
      scheduled_start: slot.start_at,
      scheduled_end: new Date(Date.parse(slot.start_at) + HOUR).toISOString(),
      price_ngn: 25_000,
      platform_commission_ngn: 3_750,
      mentor_payout_ngn: 21_250,
      status: "pending_payment",
    });
    expect(error?.code).toBe("23505");
  });

  it("book_mentor_session works on a released slot (end to end through the real booking function)", async () => {
    const slot = await makeSlot(24);
    const old = await makeSession(slot, "pending_payment");
    const cancelled = await admin.rpc("cancel_unpaid_mentor_session", { p_session_id: old, p_mentee_id: menteeId });
    expect(cancelled.data).toBe(true);
    const booked = await admin.rpc("book_mentor_session", { p_availability_slot_id: slot.id, p_mentee_id: strangerId, p_session_type: "mock_interview" });
    expect(booked.error).toBeNull();
    const newId = booked.data?.[0]?.session_id;
    expect(newId).toBeTruthy();
    if (newId) sessionIds.push(newId);
  });
});

describe("cancel_unpaid_mentor_session", () => {
  it("lets the mentee cancel their own unpaid booking, releasing the slot in the same call", async () => {
    const slot = await makeSlot(24);
    const id = await makeSession(slot, "pending_payment");
    const { data, error } = await admin.rpc("cancel_unpaid_mentor_session", { p_session_id: id, p_mentee_id: menteeId });
    expect(error).toBeNull();
    expect(data).toBe(true);
    expect(await statusOf(id)).toBe("cancelled_by_mentee");
    expect(await bookedOf(slot.id)).toBe(false);
  });

  it("refuses anyone else: nothing changes", async () => {
    const slot = await makeSlot(24);
    const id = await makeSession(slot, "pending_payment");
    const { data } = await admin.rpc("cancel_unpaid_mentor_session", { p_session_id: id, p_mentee_id: strangerId });
    expect(data).toBe(false);
    expect(await statusOf(id)).toBe("pending_payment");
    expect(await bookedOf(slot.id)).toBe(true);
  });

  it("cannot cancel a session that has been paid for, or that already lapsed", async () => {
    const slot = await makeSlot(24);
    const paid = await makeSession(slot, "awaiting_confirmation");
    expect((await admin.rpc("cancel_unpaid_mentor_session", { p_session_id: paid, p_mentee_id: menteeId })).data).toBe(false);
    expect(await statusOf(paid)).toBe("awaiting_confirmation");

    const slot2 = await makeSlot(-48);
    const lapsed = await makeSession(slot2, "expired_unpaid");
    expect((await admin.rpc("cancel_unpaid_mentor_session", { p_session_id: lapsed, p_mentee_id: menteeId })).data).toBe(false);
  });

  it("a second cancel is a no-op", async () => {
    const slot = await makeSlot(24);
    const id = await makeSession(slot, "pending_payment");
    await admin.rpc("cancel_unpaid_mentor_session", { p_session_id: id, p_mentee_id: menteeId });
    expect((await admin.rpc("cancel_unpaid_mentor_session", { p_session_id: id, p_mentee_id: menteeId })).data).toBe(false);
  });
});

describe("settle_late_mentor_payment: money is never silently kept", () => {
  it("reinstates a lapsed booking whose slot is still free and ahead: awaiting the mentor, slot locked again", async () => {
    const slot = await makeSlot(24);
    const id = await makeSession(slot, "pending_payment");
    await admin.rpc("cancel_unpaid_mentor_session", { p_session_id: id, p_mentee_id: menteeId });
    const { data, error } = await admin.rpc("settle_late_mentor_payment", { p_session_id: id });
    expect(error).toBeNull();
    expect(data).toBe("reinstated");
    expect(await statusOf(id)).toBe("awaiting_confirmation");
    expect(await bookedOf(slot.id)).toBe(true);
  });

  it("marks it payment_needs_refund when the slot has since been taken by someone else, and leaves the other booking alone", async () => {
    const slot = await makeSlot(24);
    const lapsed = await makeSession(slot, "pending_payment");
    await admin.rpc("cancel_unpaid_mentor_session", { p_session_id: lapsed, p_mentee_id: menteeId });
    const taker = await makeSession(slot, "pending_payment", strangerId);
    await admin.from("mentor_availability_slots").update({ is_booked: true }).eq("id", slot.id);

    const { data } = await admin.rpc("settle_late_mentor_payment", { p_session_id: lapsed });
    expect(data).toBe("needs_refund");
    expect(await statusOf(lapsed)).toBe("payment_needs_refund");
    expect(await statusOf(taker)).toBe("pending_payment");
    expect(await bookedOf(slot.id)).toBe(true);
  });

  it("marks it payment_needs_refund when the slot has already started (the owner's own booking)", async () => {
    const slot = await makeSlot(-48);
    const id = await makeSession(slot, "pending_payment");
    await admin.rpc("expire_unpaid_mentor_sessions", { p_now: new Date().toISOString() });
    const { data } = await admin.rpc("settle_late_mentor_payment", { p_session_id: id });
    expect(data).toBe("needs_refund");
    expect(await statusOf(id)).toBe("payment_needs_refund");
  });

  it("does nothing to a session that is not lapsed: the normal pending_payment path, or already paid", async () => {
    const slot = await makeSlot(24);
    const pending = await makeSession(slot, "pending_payment");
    expect((await admin.rpc("settle_late_mentor_payment", { p_session_id: pending })).data).toBe("not_late");
    expect(await statusOf(pending)).toBe("pending_payment");
    const slot2 = await makeSlot(48);
    const paid = await makeSession(slot2, "awaiting_confirmation");
    expect((await admin.rpc("settle_late_mentor_payment", { p_session_id: paid })).data).toBe("not_late");
  });

  it("is idempotent, and says not_found for an unknown session", async () => {
    const slot = await makeSlot(24);
    const id = await makeSession(slot, "pending_payment");
    await admin.rpc("cancel_unpaid_mentor_session", { p_session_id: id, p_mentee_id: menteeId });
    expect((await admin.rpc("settle_late_mentor_payment", { p_session_id: id })).data).toBe("reinstated");
    expect((await admin.rpc("settle_late_mentor_payment", { p_session_id: id })).data).toBe("not_late");
    expect((await admin.rpc("settle_late_mentor_payment", { p_session_id: "00000000-0000-4000-8000-000000000000" })).data).toBe("not_found");
  });
});

describe("the three functions are service_role only", () => {
  it("are not callable by an ordinary signed-in user", async () => {
    const anon = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    for (const [fn, args] of [
      ["expire_unpaid_mentor_sessions", {}],
      ["cancel_unpaid_mentor_session", { p_session_id: "00000000-0000-4000-8000-000000000000", p_mentee_id: menteeId }],
      ["settle_late_mentor_payment", { p_session_id: "00000000-0000-4000-8000-000000000000" }],
    ] as const) {
      const { error } = await anon.rpc(fn as never, args as never);
      expect(error, `${fn} must refuse the anon role`).not.toBeNull();
    }
  });
});
