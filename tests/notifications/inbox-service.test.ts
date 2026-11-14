/**
 * The inbox over the user's own notifications, through the SESSION client: the newest 20, a plain count of unread rows, mark one read, mark all read. Every query is scoped to the signed-in user's id AND
 * (for the writers) to rows that are still unread; the count is the answer after the write, so the bell and the app badge show the same number.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { countUnread, listInbox, markAllRead, markOneRead } from "@/lib/notifications/inbox/service";

type Call = [string, ...unknown[]];
let calls: Call[];
/** One entry per query: the calls made on THAT query's builder, so a check on the write cannot be satisfied by the count query that follows it. */
let queries: Call[][];
let rows: Array<Record<string, unknown>>;
let unreadAfter: number;
let failWith: string | null;

function builder(): object {
  const own: Call[] = [];
  queries.push(own);
  let op = "select";
  let head = false;
  const b: object = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => {
            if (failWith) return resolve({ data: null, count: null, error: { message: failWith } });
            if (op === "update") return resolve({ data: [{ id: "n1" }], error: null });
            if (head) return resolve({ data: null, count: unreadAfter, error: null });
            return resolve({ data: rows, error: null });
          };
        }
        return (...args: unknown[]) => {
          calls.push([String(prop), ...args]);
          own.push([String(prop), ...args]);
          if (prop === "update") op = "update";
          if (prop === "select" && (args[1] as { head?: boolean } | undefined)?.head) head = true;
          return b;
        };
      },
    },
  );
  return b;
}
const db = { from: (t: string) => (calls.push(["from", t]), builder()) } as never;

beforeEach(() => {
  calls = [];
  queries = [];
  failWith = null;
  unreadAfter = 3;
  rows = [{ id: "n1", type: "match", title: "A", body: "b", link: "/jobs/1", created_at: "2026-11-01T00:00:00Z", read_at: null }];
});

describe("countUnread", () => {
  it("is a head count of this user's rows with no read_at, through the given client", async () => {
    expect(await countUnread(db, "u-1")).toBe(3);
    expect(calls).toContainEqual(["from", "user_notifications"]);
    expect(calls).toContainEqual(["select", "id", { count: "exact", head: true }]);
    expect(calls).toContainEqual(["eq", "user_id", "u-1"]);
    expect(calls).toContainEqual(["is", "read_at", null]);
  });
  it("is null (unknown) on a database error, never 0", async () => {
    failWith = "boom";
    expect(await countUnread(db, "u-1")).toBeNull();
  });
});

describe("listInbox", () => {
  it("reads the newest 20 for this user, newest first", async () => {
    await listInbox(db, "u-1");
    expect(calls).toContainEqual(["eq", "user_id", "u-1"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 20]);
  });
  it("maps rows to items; a link that is not a same-origin path is dropped but the item stays", async () => {
    rows = [
      { id: "n1", type: "match", title: "A", body: "b", link: "/jobs/1", created_at: "2026-11-02T00:00:00Z", read_at: null },
      { id: "n2", type: "x", title: "B", body: "c", link: "https://evil.example/x", created_at: "2026-11-01T00:00:00Z", read_at: "2026-11-02T00:00:00Z" },
    ];
    const out = await listInbox(db, "u-1");
    expect(out?.items.map((i) => [i.id, i.link, i.read])).toEqual([["n1", "/jobs/1", false], ["n2", null, true]]);
    expect(out?.unreadCount).toBe(3);
  });
  it("is null on a database error", async () => {
    failWith = "boom";
    expect(await listInbox(db, "u-1")).toBeNull();
  });
});

describe("the writers", () => {
  it("mark one: only that id, only this user's, only if still unread; returns the count after", async () => {
    unreadAfter = 2;
    expect(await markOneRead(db, "u-1", "n1")).toEqual({ ok: true, unreadCount: 2 });
    const write = queries.find((q) => q.some((c) => c[0] === "update")) as Call[];
    expect(Object.keys(write.find((c) => c[0] === "update")![1] as object)).toEqual(["read_at"]);
    expect(write).toContainEqual(["eq", "id", "n1"]);
    expect(write, "the write itself is scoped to this user").toContainEqual(["eq", "user_id", "u-1"]);
    expect(write).toContainEqual(["is", "read_at", null]);
  });
  it("mark all: this user's unread rows only; returns the count after", async () => {
    unreadAfter = 0;
    expect(await markAllRead(db, "u-1")).toEqual({ ok: true, unreadCount: 0 });
    const writes = queries.filter((q) => q.some((c) => c[0] === "update"));
    expect(writes).toHaveLength(1);
    expect(writes[0], "the write itself is scoped to this user").toContainEqual(["eq", "user_id", "u-1"]);
    expect(writes[0]).toContainEqual(["is", "read_at", null]);
    expect(writes[0].some((c) => c[0] === "eq" && c[1] === "id")).toBe(false);
  });
  it("a failed write reports ok:false and writes nothing else", async () => {
    failWith = "boom";
    expect(await markAllRead(db, "u-1")).toEqual({ ok: false });
    expect(await markOneRead(db, "u-1", "n1")).toEqual({ ok: false });
  });
});
