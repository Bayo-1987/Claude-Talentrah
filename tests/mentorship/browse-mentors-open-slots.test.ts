/**
 * send-497 / S15 — browseMentors carries each mentor's open-slot count, from ONE batched slots query (not one per
 * mentor), filtered the way the mentor's own profile page filters (unbooked, in the future).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ list: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }> }));
const slotRows = vi.hoisted(() => ({ rows: [] as Array<{ mentor_id: string }> }));
const rpcCalls = vi.hoisted(() => ({ list: [] as Array<{ fn: string; args: Record<string, unknown> }> }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const entry = { table, ops: [] as Array<[string, unknown[]]> };
      calls.list.push(entry);
      const result = () =>
        table === "mentor_profiles"
          ? {
              data: [
                { user_id: "m-with", bio: null, expertise_roles: [], expertise_industries: [], expertise_seniority: [], years_experience: null, base_price_ngn: 20000, mentorship_reviews: [] },
                { user_id: "m-without", bio: null, expertise_roles: [], expertise_industries: [], expertise_seniority: [], years_experience: null, base_price_ngn: 15000, mentorship_reviews: [] },
              ],
              error: null,
            }
          : { data: slotRows.rows, error: null };
      const chain: Record<string, unknown> = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result());
            return (...args: unknown[]) => {
              entry.ops.push([String(prop), args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.list.push({ fn, args });
      if (fn === "open_mentor_slots") return { data: slotRows.rows, error: null };
      return { data: [{ user_id: "m-with", display_name: "With Slots", first_name: null, last_name: null }, { user_id: "m-without", display_name: "No Slots", first_name: null, last_name: null }], error: null };
    },
  }),
}));

import { browseMentors } from "@/lib/mentorship/queries";

beforeEach(() => {
  calls.list.length = 0;
  rpcCalls.list.length = 0;
  slotRows.rows = [{ mentor_id: "m-with" }, { mentor_id: "m-with" }];
});

describe("browseMentors open slots", () => {
  it("returns openSlotCount per mentor, zero for a mentor with none", async () => {
    const mentors = (await browseMentors()) as Array<{ userId: string; openSlotCount?: number }>;
    expect(mentors.find((m) => m.userId === "m-with")?.openSlotCount).toBe(2);
    expect(mentors.find((m) => m.userId === "m-without")?.openSlotCount).toBe(0);
  });

  it("asks for the slots in ONE batched call to open_mentor_slots, which ignores stale unpaid holds in SQL (send-502)", async () => {
    await browseMentors();
    // Not a table read of is_booked = false: that would count a lapsed 30-minute hold as taken.
    expect(calls.list.filter((c) => c.table === "mentor_availability_slots"), "no direct slots table read").toHaveLength(0);
    const slotCalls = rpcCalls.list.filter((c) => c.fn === "open_mentor_slots");
    expect(slotCalls, "one batched call, not one per mentor").toHaveLength(1);
    expect(slotCalls[0].args.p_mentor_ids).toEqual(["m-with", "m-without"]);
  });
});
