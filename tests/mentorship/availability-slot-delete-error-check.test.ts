/**
 * send-450 (QA audit, 2026-09-21) — `deleteAvailabilitySlotAction`
 * (src/lib/mentorship/actions.ts) discarded its Supabase `.delete()` result
 * with no `error` check, the exact incident shape CLAUDE.md documents ("A
 * Supabase delete that is rejected does NOT throw — it resolves with an
 * `error`"). No existing test called this action directly either way —
 * tests/rls/mentorship.test.ts exercises the RLS policy at the raw-table
 * level (a booked slot's delete is a legitimate zero-row no-op, correctly
 * asserted as `error: null`), but never the Server Action itself. This file
 * is that missing coverage, added alongside the fix rather than after it.
 *
 * Mocking convention copied from tests/passes/pass-covered-actions.test.ts:
 * `createClient()` is mocked to hand back a real, RLS-honouring session
 * (sessionFor()) rather than a stub, since RLS is exactly what a stub would
 * silently bypass; `next/cache`'s `revalidatePath` is stubbed because it
 * needs an active Next.js request/static-generation context a plain vitest
 * run never has.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { admin, createAuthedTestUser, deleteTestUsers, type DB } from "../support/auth";

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
  if (!process.env[key]) throw new Error(`availability-slot-delete-error-check suite cannot run: ${key} is not set.`);
}

const testClientRef = vi.hoisted(() => ({ current: null as DB | null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => testClientRef.current,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { deleteAvailabilitySlotAction } = await import("@/lib/mentorship/actions");

let mentor: { id: string; email: string; client: DB };

beforeAll(async () => {
  mentor = await createAuthedTestUser("avail-delete-qa");
  const { error } = await admin.from("mentor_profiles").insert({
    user_id: mentor.id,
    status: "approved",
    bio: "send-450 QA-audit regression mentor",
    base_price_ngn: 12_000,
  });
  if (error) throw error;
  testClientRef.current = mentor.client;
});

afterAll(async () => {
  await deleteTestUsers([mentor.id]);
});

async function insertOpenSlot(): Promise<string> {
  const { data, error } = await admin
    .from("mentor_availability_slots")
    .insert({
      mentor_id: mentor.id,
      start_at: new Date(Date.now() + 3600_000).toISOString(),
      end_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("no slot");
  return data.id;
}

describe("deleteAvailabilitySlotAction — the error-check fix (send-450/QA audit)", () => {
  it("succeeds and actually removes the caller's own open slot", async () => {
    const slotId = await insertOpenSlot();

    await expect(deleteAvailabilitySlotAction(slotId)).resolves.toBeUndefined();

    const { data: after } = await admin
      .from("mentor_availability_slots")
      .select("id")
      .eq("id", slotId)
      .maybeSingle();
    expect(after, "the slot must actually be gone, not just reported as deleted").toBeNull();
  });

  it("REGRESSION: throws when the delete query itself errors — proves `if (error) throw` is real, reachable code, not dead code", async () => {
    // A malformed UUID makes Postgres reject the query at the type-cast
    // level (22P02 invalid input syntax for type uuid) — a genuine query
    // error, structurally different from the legitimate zero-row RLS no-op
    // a wrong-but-valid id produces (tests/rls/mentorship.test.ts's own "a
    // mentor cannot delete an already-booked slot" is that no-op case, and
    // correctly asserts `error: null` there — this test asserts the other
    // branch). Before this fix, a query error here would have resolved
    // successfully instead of throwing, silently reporting removal of a row
    // that was never touched.
    await expect(deleteAvailabilitySlotAction("not-a-valid-uuid")).rejects.toThrow("Could not remove that slot.");
  });
});
