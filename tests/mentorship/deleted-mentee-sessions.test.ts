/**
 * send-512 / PR 0 — a mentorship session whose mentee's account was deleted.
 *
 * 0209 detaches the session (mentee_id becomes null) instead of deleting it: it is also the mentor's record. Every reader must show "Deleted user"
 * for that party and keep the row: never crash on the null, never drop the session from the mentor's list, never send the null to a lookup.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  rpcArgs: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        order: async () => ({ data: h.rows, error: null }),
      };
      return q;
    },
    rpc: async (_name: string, args: { p_user_ids: unknown[] }) => {
      h.rpcArgs.push(args.p_user_ids);
      return {
        data: [{ user_id: "mentor-1", display_name: "Ada Mentor", first_name: "Ada", last_name: "M" }],
        error: null,
      };
    },
  }),
}));

const session = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  mentor_id: "mentor-1",
  mentee_id: "mentee-1",
  session_type: "mock_interview",
  scheduled_start: "2026-10-10T10:00:00Z",
  scheduled_end: "2026-10-10T11:00:00Z",
  price_ngn: 5000,
  status: "confirmed",
  meeting_link: null,
  created_at: "2026-10-01T10:00:00Z",
  ...over,
});

beforeEach(() => {
  h.rpcArgs.length = 0;
});

describe("sessions whose mentee was deleted", () => {
  it("the mentor still sees the session, with the mentee named 'Deleted user' and a null id", async () => {
    h.rows = [session({ mentee_id: null })];
    const { sessionsAsMentor, DELETED_USER_NAME } = await import("@/lib/mentorship/queries");
    const rows = await sessionsAsMentor("mentor-1");
    expect(DELETED_USER_NAME).toBe("Deleted user");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "s1", menteeId: null, menteeName: "Deleted user", mentorName: "Ada Mentor" });
  });

  it("the null is never sent to the counterparty-name lookup", async () => {
    h.rows = [session({ mentee_id: null })];
    const { sessionsAsMentor } = await import("@/lib/mentorship/queries");
    await sessionsAsMentor("mentor-1");
    expect(h.rpcArgs).toEqual([["mentor-1"]]);
  });

  it("a mix of live and deleted mentees keeps every row, in order", async () => {
    h.rows = [session({ id: "s1", mentee_id: null }), session({ id: "s2", mentee_id: "mentee-2" })];
    const { sessionsAsMentor } = await import("@/lib/mentorship/queries");
    const rows = await sessionsAsMentor("mentor-1");
    expect(rows.map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(rows[0].menteeName).toBe("Deleted user");
    expect(rows[1].menteeName).toBe("Mentee");
  });
});
