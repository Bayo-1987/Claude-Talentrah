/**
 * saveFarahExchange: the server's save of one exchange. The service-role client is mocked at the module boundary.
 *   1. both rows are written through the service-role client, for the given user, and the reply row's id and time come back;
 *   2. when a write fails it returns null and logs error codes only: never the message text or the reply.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const writes: Array<{ table: string; row: Record<string, unknown> }> = [];
let failWith: { code: string } | null = null;

function fakeServiceClient() {
  return {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          writes.push({ table, row });
          const result = failWith ? { data: null, error: failWith } : { data: { id: "reply-1", created_at: "2026-01-01T00:00:00.000Z" }, error: null };
          const chain = { select: () => chain, single: async () => result, then: (resolve: (v: unknown) => void) => resolve({ error: failWith }) };
          return chain;
        },
      };
    },
  };
}
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => fakeServiceClient() }));
const { saveFarahExchange } = await import("@/lib/farah/save-exchange");

const params = { userId: "u-1", message: "a distinctive question 4c9e", reply: "a distinctive answer 71b2", userRowContext: {}, replyRowContext: { tokens: { prompt: 1, completion: 2 } } };

beforeEach(() => {
  writes.length = 0;
  failWith = null;
});

describe("saveFarahExchange", () => {
  it("writes the user row and the reply row for the given user, and returns the reply row's id and time", async () => {
    const saved = await saveFarahExchange(params);
    expect(saved).toEqual({ id: "reply-1", createdAt: "2026-01-01T00:00:00.000Z" });
    expect(writes.map((w) => [w.table, w.row.user_id, w.row.role, w.row.content])).toEqual([
      ["farah_messages", "u-1", "user", params.message],
      ["farah_messages", "u-1", "farah", params.reply],
    ]);
    expect(writes[1].row.context).toEqual(params.replyRowContext);
  });

  it("returns null when a write fails, and logs the error codes only", async () => {
    failWith = { code: "42501" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const saved = await saveFarahExchange(params);
    expect(saved).toBeNull();
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("42501");
    expect(logged).not.toContain("4c9e");
    expect(logged).not.toContain("71b2");
    expect(logged).not.toContain("u-1");
    spy.mockRestore();
  });
});
