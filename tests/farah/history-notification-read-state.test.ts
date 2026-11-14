/**
 * NOTIF-FARAH-HISTORY-1 with the inbox flag in the picture. The bell exists only while notifications_master is ON, so:
 *  - flag OFF: there is no bell, and the Farah panel is the only place an unread notification can be seen. GET /api/farah/history keeps its OLD behaviour: it reports the unread state as it was before marking, then
 *    marks every unread row read through the session's own client, or the Farah dot would never clear. (These are the characterisation tests the branch's first commit pinned.)
 *  - flag ON: the bell owns read state. The route never writes user_notifications and reports unread on every call while unread rows exist.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const hasActivePass = vi.fn();
const farahChatFreeMessagesRemaining = vi.fn();
const farahChatNextFreeMessageAt = vi.fn();
const checkFarahChatAllowance = vi.fn();
const commitFarahChatAllowance = vi.fn();
const writes: Array<{ table: string; values: Record<string, unknown> }> = [];
const state = { unread: [] as Array<{ id: string }> };
const serviceRoleCalls: string[] = [];
const inboxOn = vi.fn();

function table(name: string): unknown {
  let op: "select" | "update" = "select";
  const chain: object = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => {
            if (name === "user_notifications") {
              if (op === "update") {
                state.unread = [];
                return resolve({ data: null, error: null });
              }
              return resolve({ data: state.unread, error: null });
            }
            return resolve({ data: [], error: null });
          };
        }
        if (prop === "update") {
          return (values: Record<string, unknown>) => {
            op = "update";
            writes.push({ table: name, values });
            return chain;
          };
        }
        return () => chain;
      },
    },
  );
  return chain;
}
const fakeSupabase = () => ({ auth: { getUser }, from: (name: string) => table(name) });

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase() }));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => {
    serviceRoleCalls.push("createServiceRoleClient");
    return fakeSupabase();
  },
}));
vi.mock("@/lib/notifications/inbox/enabled", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/notifications/inbox/enabled")>()), inboxEnabled: inboxOn }));
vi.mock("@/lib/passes/entitlement", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/passes/entitlement")>()), hasActivePass }));
vi.mock("@/lib/farah/chat-gate", async () => (await import("./support/route-mocks")).safeChatGate({ checkFarahChatAllowance, commitFarahChatAllowance, farahChatFreeMessagesRemaining, farahChatNextFreeMessageAt }));

const { GET } = await import("@/app/api/farah/history/route");

beforeEach(() => {
  writes.length = 0;
  serviceRoleCalls.length = 0;
  state.unread = [];
  inboxOn.mockReset().mockResolvedValue(false);
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u-1" } } });
  hasActivePass.mockReset().mockResolvedValue(false);
  farahChatFreeMessagesRemaining.mockReset().mockResolvedValue(2);
  farahChatNextFreeMessageAt.mockReset().mockResolvedValue(null);
});

describe("flag OFF (no bell): the history route keeps its old behaviour", () => {
  beforeEach(() => inboxOn.mockResolvedValue(false));

  it("reports the unread state as it was before marking, then marks every unread row read through the session's client", async () => {
    state.unread = [{ id: "n1" }, { id: "n2" }];
    const body = await (await GET()).json();
    expect(body.hasUnreadNotification).toBe(true);
    const marks = writes.filter((w) => w.table === "user_notifications");
    expect(marks).toHaveLength(1);
    expect(typeof marks[0].values.read_at).toBe("string");
    expect(Number.isNaN(Date.parse(marks[0].values.read_at as string))).toBe(false);
    expect(Object.keys(marks[0].values)).toEqual(["read_at"]);
  });

  it("the dot shows for the load that marks, and is gone on the next call", async () => {
    state.unread = [{ id: "n1" }];
    expect((await (await GET()).json()).hasUnreadNotification).toBe(true);
    expect((await (await GET()).json()).hasUnreadNotification).toBe(false);
  });

  it("nothing unread: false, and nothing is written to user_notifications", async () => {
    const body = await (await GET()).json();
    expect(body.hasUnreadNotification).toBe(false);
    expect(writes).toEqual([]);
  });

  it("never reaches for the service role", async () => {
    state.unread = [{ id: "n1" }];
    await GET();
    expect(serviceRoleCalls).toEqual([]);
  });

  it("a flag read that fails is OFF: the old behaviour (fail closed means no bell, so the panel must still clear its dot)", async () => {
    inboxOn.mockResolvedValue(false);
    state.unread = [{ id: "n1" }];
    await GET();
    expect(writes.filter((w) => w.table === "user_notifications")).toHaveLength(1);
  });
});

describe("flag ON (the bell owns read state): the history route never marks", () => {
  beforeEach(() => inboxOn.mockResolvedValue(true));

  it("GET /api/farah/history never writes user_notifications", async () => {
    state.unread = [{ id: "n1" }, { id: "n2" }];
    await GET();
    expect(writes).toEqual([]);
  });

  it("reports hasUnreadNotification true while unread rows exist, and the same on the next call (reading does not clear it)", async () => {
    state.unread = [{ id: "n1" }];
    expect((await (await GET()).json()).hasUnreadNotification).toBe(true);
    expect((await (await GET()).json()).hasUnreadNotification).toBe(true);
    expect(state.unread).toEqual([{ id: "n1" }]);
  });

  it("nothing unread: false, and nothing is written to user_notifications", async () => {
    const body = await (await GET()).json();
    expect(body.hasUnreadNotification).toBe(false);
    expect(writes).toEqual([]);
  });

  it("never reaches for the service role", async () => {
    state.unread = [{ id: "n1" }];
    await GET();
    expect(serviceRoleCalls).toEqual([]);
  });
});
