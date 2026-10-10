/**
 * MENTOR-SLOT-2 (QA, P3): the same availability slot could be posted twice, so two mentees could book the same half hour, and a failed post threw out of the page.
 *
 * postAvailabilitySlotAction now looks for a slot of THIS mentor that overlaps the new one (identical or partly overlapping) before inserting, and answers in words instead of throwing:
 * "You already have a slot at that time." (nothing inserted), "Could not post that slot" on a database error. Fakes only. NOT closed by this: two requests in the very same instant can both pass
 * the look (a read then a write); the full fix is a database constraint (an exclusion constraint on (mentor_id, time range), or at least a unique index on (mentor_id, start_at, end_at)): a migration, written up for the owner.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const world = vi.hoisted(() => ({
  existing: [] as Array<{ start_at: string; end_at: string }>,
  inserts: [] as Array<Record<string, unknown>>,
  insertError: null as { message: string } | null,
  filters: [] as Array<[string, string, unknown]>,
}));

vi.mock("@/lib/auth/require-user", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/require-user")>()), requireUser: async () => ({ user: { id: "mentor-1" } }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => {
        const q: Record<string, unknown> = {
          eq: (c: string, v: unknown) => (world.filters.push(["eq", c, v]), q),
          lt: (c: string, v: unknown) => (world.filters.push(["lt", c, v]), q),
          gt: (c: string, v: unknown) => (world.filters.push(["gt", c, v]), q),
          limit: async () => {
            const lt = world.filters.find((f) => f[0] === "lt")![2] as string;
            const gt = world.filters.find((f) => f[0] === "gt")![2] as string;
            return { data: world.existing.filter((s) => s.start_at < lt && s.end_at > gt), error: null };
          },
        };
        return q;
      },
      insert: async (row: Record<string, unknown>) => {
        world.inserts.push(row);
        return { error: world.insertError };
      },
    }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/paystack/client", () => ({ initializeTransaction: vi.fn(), NGN_CHANNELS: [] }));

const { postAvailabilitySlotAction } = await import("@/lib/mentorship/actions");

const S = "2026-11-01T10:00:00.000Z";
const E = "2026-11-01T10:30:00.000Z";

beforeEach(() => {
  world.existing = [];
  world.inserts = [];
  world.insertError = null;
  world.filters = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("posting a slot", () => {
  it("a free time is inserted for this mentor and reported as posted", async () => {
    const out = await postAvailabilitySlotAction(S, E);
    expect(out.status).toBe("posted");
    expect(world.inserts).toEqual([{ mentor_id: "mentor-1", start_at: S, end_at: E }]);
  });
  it("an IDENTICAL slot already posted: refused in words, nothing inserted", async () => {
    world.existing = [{ start_at: S, end_at: E }];
    const out = await postAvailabilitySlotAction(S, E);
    expect(out).toMatchObject({ status: "overlaps", message: "You already have a slot at that time." });
    expect(world.inserts).toEqual([]);
  });
  it("a PARTLY overlapping slot is refused too", async () => {
    world.existing = [{ start_at: "2026-11-01T10:15:00.000Z", end_at: "2026-11-01T10:45:00.000Z" }];
    expect((await postAvailabilitySlotAction(S, E)).status).toBe("overlaps");
    expect(world.inserts).toEqual([]);
  });
  it("back-to-back slots (one ends exactly when the next starts) are NOT an overlap", async () => {
    world.existing = [{ start_at: "2026-11-01T09:30:00.000Z", end_at: S }];
    expect((await postAvailabilitySlotAction(S, E)).status).toBe("posted");
    world.existing = [{ start_at: E, end_at: "2026-11-01T11:00:00.000Z" }];
    expect((await postAvailabilitySlotAction(S, E)).status).toBe("posted");
  });
  it("only this mentor's own slots are looked at", async () => {
    await postAvailabilitySlotAction(S, E);
    expect(world.filters).toContainEqual(["eq", "mentor_id", "mentor-1"]);
  });
  it("a database error on the insert: a message, not a throw", async () => {
    world.insertError = { message: "boom" };
    const out = await postAvailabilitySlotAction(S, E);
    expect(out).toMatchObject({ status: "error", message: expect.stringMatching(/could not post/i) });
  });
});

describe("the form", () => {
  const form = readFileSync(path.join(__dirname, "../../src/app/(app)/mentorship/apply/availability-manager.tsx"), "utf8").replace(/\s+/g, " ");
  it("shows the refusal and keeps the typed times when a slot is refused; clears them only after a post", () => {
    expect(form).toContain("const result = await postAvailabilitySlotAction(");
    expect(form).toMatch(/if \(result\.status !== "posted"\) \{ setError\(result\.message/);
    expect(form.indexOf('setStart("")')).toBeGreaterThan(form.indexOf('result.status !== "posted"'));
  });
});
