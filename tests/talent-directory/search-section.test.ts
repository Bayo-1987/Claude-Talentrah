/**
 * V5 / migration 0268, the code side: what searchTalentDirectory does with the `section` the database answers. The label is the DATABASE's answer, never worked out from a boost date (the boost date is not returned);
 * a missing or unknown value reads as "organic", the unmarked reading, never a claim of paid placement the database did not make. Unit-level, with a fake client that answers like supabase-js (rpc returns { data, error }).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] as Array<{ name: string; args: Record<string, unknown> }>, rows: [] as Array<Record<string, unknown>>, error: null as { message: string } | null }));

vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      return { data: state.error ? null : state.rows, error: state.error };
    },
  }),
}));

import { searchTalentDirectory } from "@/lib/talent-directory/queries";

const row = (over: Record<string, unknown> = {}) => ({
  user_id: "u1", first_name: "Ada", last_name: "Okafor", country: "Nigeria", available_for_hire: true, remote_ready: true,
  earliest_start_date: null, verified_at: "2026-10-05T09:30:00Z", review_type: "ai", section: "organic", ...over,
});

beforeEach(() => {
  state.calls.length = 0;
  state.rows = [];
  state.error = null;
});

describe("searchTalentDirectory carries the section the database answered", () => {
  it("maps 'promoted' to promoted and 'organic' to organic, row by row, in the order returned", async () => {
    state.rows = [row({ user_id: "p", section: "promoted" }), row({ user_id: "o", section: "organic" })];
    const got = await searchTalentDirectory({});
    expect(got.map((c) => [c.userId, c.section])).toEqual([["p", "promoted"], ["o", "organic"]]);
  });

  it.each([[undefined], [null], [""], ["Promoted"], ["featured"], [7]])("reads %s as organic (never a claim the database did not make)", async (value) => {
    state.rows = [row({ section: value })];
    expect((await searchTalentDirectory({}))[0].section).toBe("organic");
  });

  it("keeps every field it already mapped, unchanged", async () => {
    state.rows = [row({ section: "promoted" })];
    expect((await searchTalentDirectory({}))[0]).toEqual({
      userId: "u1", firstName: "Ada", lastName: "Okafor", country: "Nigeria", availableForHire: true, remoteReady: true,
      earliestStartDate: null, verifiedAt: "2026-10-05T09:30:00Z", reviewType: "ai", section: "promoted",
    });
  });

  it("sends the same arguments as before (no new argument, so a caller cannot choose the strip)", async () => {
    await searchTalentDirectory({ remoteReady: true, limit: 5, offset: 10, candidateId: "c" });
    expect(state.calls).toHaveLength(1);
    expect(state.calls[0].name).toBe("talent_directory_search");
    expect(Object.keys(state.calls[0].args).sort()).toEqual(["p_available_for_hire", "p_candidate_id", "p_limit", "p_offset", "p_remote_ready"]);
    expect(state.calls[0].args).toMatchObject({ p_remote_ready: true, p_limit: 5, p_offset: 10, p_candidate_id: "c" });
  });

  it("still throws the database's error", async () => {
    state.error = { message: "boom" };
    await expect(searchTalentDirectory({})).rejects.toMatchObject({ message: "boom" });
  });
});
