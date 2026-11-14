/**
 * src/lib/notifications/unread.ts, hasUnreadNotification (characterisation, written first, green on unchanged code): an EXISTENCE check on the user's unread rows; false on a database error, and the error is logged
 * with the user id; scoped by user id and to rows with no read_at. Through the service role, as it is today (the layout's Farah dot).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<[string, ...unknown[]]> = [];
const result = { count: 0 as number | null, error: null as null | { message: string } };

function chain(): object {
  const c: object = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ count: result.count, error: result.error });
        return (...args: unknown[]) => {
          calls.push([String(prop), ...args]);
          return c;
        };
      },
    },
  );
  return c;
}
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ from: (t: string) => (calls.push(["from", t]), chain()) }) }));

const { hasUnreadNotification } = await import("@/lib/notifications/unread");

beforeEach(() => {
  calls.length = 0;
  result.count = 0;
  result.error = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("hasUnreadNotification", () => {
  it("true when at least one unread row exists, false when none", async () => {
    result.count = 3;
    expect(await hasUnreadNotification("u-1")).toBe(true);
    result.count = 0;
    expect(await hasUnreadNotification("u-1")).toBe(false);
    result.count = null;
    expect(await hasUnreadNotification("u-1")).toBe(false);
  });
  it("is an existence check (a head count), scoped to the user's own unread rows", async () => {
    await hasUnreadNotification("u-42");
    expect(calls).toContainEqual(["from", "user_notifications"]);
    expect(calls).toContainEqual(["select", "id", { count: "exact", head: true }]);
    expect(calls).toContainEqual(["eq", "user_id", "u-42"]);
    expect(calls).toContainEqual(["is", "read_at", null]);
  });
  it("false on a database error, and the error is logged with the user id", async () => {
    result.error = { message: "boom" };
    result.count = 5;
    expect(await hasUnreadNotification("u-7")).toBe(false);
    const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("u-7");
    expect(logged).toContain("boom");
  });
});
