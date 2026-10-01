/**
 * send-497 / S15 — browseMentors carries each mentor's open-slot count, from ONE batched slots query (not one per
 * mentor), filtered the way the mentor's own profile page filters (unbooked, in the future).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ list: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }> }));
const slotRows = vi.hoisted(() => ({ rows: [] as Array<{ mentor_id: string }> }));

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
    rpc: async () => ({ data: [{ user_id: "m-with", display_name: "With Slots", first_name: null, last_name: null }, { user_id: "m-without", display_name: "No Slots", first_name: null, last_name: null }], error: null }),
  }),
}));

import { browseMentors } from "@/lib/mentorship/queries";

beforeEach(() => {
  calls.list.length = 0;
  slotRows.rows = [{ mentor_id: "m-with" }, { mentor_id: "m-with" }];
});

describe("browseMentors open slots", () => {
  it("returns openSlotCount per mentor, zero for a mentor with none", async () => {
    const mentors = (await browseMentors()) as Array<{ userId: string; openSlotCount?: number }>;
    expect(mentors.find((m) => m.userId === "m-with")?.openSlotCount).toBe(2);
    expect(mentors.find((m) => m.userId === "m-without")?.openSlotCount).toBe(0);
  });

  it("asks for the slots in ONE batched query, unbooked and in the future, like the profile page", async () => {
    await browseMentors();
    const slotQueries = calls.list.filter((c) => c.table === "mentor_availability_slots");
    expect(slotQueries, "one batched slots query, not one per mentor").toHaveLength(1);
    const ops = slotQueries[0].ops;
    expect(ops).toContainEqual(["in", ["mentor_id", ["m-with", "m-without"]]]);
    expect(ops).toContainEqual(["eq", ["is_booked", false]]);
    expect(ops.find(([n, a]) => n === "gt" && a[0] === "start_at"), "must be filtered to future slots").toBeDefined();
  });
});
