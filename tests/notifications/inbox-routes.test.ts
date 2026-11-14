/**
 * /api/notifications, /api/notifications/read-all and /api/notifications/{id}/read. Flag first: with notifications_master OFF (or unreadable) every route answers 404 BEFORE it looks at the session or reads or
 * writes user_notifications. With it ON: 401 signed out, the session client only, the unread count in every answer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const flag = vi.fn();
const getUser = vi.fn();
const touched: string[] = [];
let unread = 4;
function builder(table: string): object {
  touched.push(table);
  let head = false;
  const b: object = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(head ? { data: null, count: unread, error: null } : { data: [], error: null });
      return (...args: unknown[]) => {
        if (prop === "select" && (args[1] as { head?: boolean } | undefined)?.head) head = true;
        return b;
      };
    },
  });
  return b;
}
vi.mock("@/lib/flags/read", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/flags/read")>()), isFeatureEnabled: flag }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser }, from: (t: string) => builder(t) }) }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => { throw new Error("the inbox must not use the service role"); } }));

const { GET } = await import("@/app/api/notifications/route");
const { POST: readAll } = await import("@/app/api/notifications/read-all/route");
const { POST: readOne } = await import("@/app/api/notifications/[id]/read/route");

const ID = "11111111-1111-4111-8111-111111111111";
const one = (id = ID) => readOne(new Request("http://localhost/api/notifications/x/read", { method: "POST" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  touched.length = 0;
  unread = 4;
  flag.mockReset().mockResolvedValue(true);
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u-1" } } });
});

describe("flag OFF (or unreadable): 404 before anything else", () => {
  it.each([["GET list", () => GET()], ["POST read-all", () => readAll()], ["POST read one", () => one()]])("%s", async (_n, call) => {
    flag.mockResolvedValue(false);
    const res = await call();
    expect(res.status).toBe(404);
    expect(flag).toHaveBeenCalledWith("notifications_master");
    expect(getUser).not.toHaveBeenCalled();
    expect(touched).toEqual([]);
  });
});

describe("flag ON", () => {
  it("signed out: 401 on all three, nothing read or written", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    for (const call of [() => GET(), () => readAll(), () => one()]) expect((await call()).status).toBe(401);
    expect(touched).toEqual([]);
  });
  it("list answers { items, unreadCount }, reading user_notifications through the session client", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [], unreadCount: 4 });
    expect(touched.every((t) => t === "user_notifications")).toBe(true);
  });
  it("read-all and read-one answer the count after the write", async () => {
    unread = 0;
    expect(await (await readAll()).json()).toEqual({ unreadCount: 0 });
    unread = 3;
    expect(await (await one()).json()).toEqual({ unreadCount: 3 });
  });
  it("read-one refuses an id that is not a uuid, before touching the table", async () => {
    const res = await one("not-a-uuid");
    expect(res.status).toBe(400);
    expect(touched).toEqual([]);
  });
});
