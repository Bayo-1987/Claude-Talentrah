/**
 * NOTIF-FARAH-HISTORY-1, characterisation (written FIRST, green on unchanged code): GET /api/farah/history reports the unread state as it was BEFORE marking, then marks every unread row read
 * through the session's own client. No existing test pinned this (tests/farah/history-restore, history-writers-scan and e2e/farah-history-restore do not). The U1 commit turns these into their
 * deliberate successors: the route never writes user_notifications, and reports unread on every call while unread rows exist.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const hasActivePass = vi.fn();
const farahChatFreeMessagesRemaining = vi.fn();
const farahChatNextFreeMessageAt = vi.fn();
const writes: Array<{ table: string; values: Record<string, unknown> }> = [];
const state = { unread: [] as Array<{ id: string }> };
const serviceRoleCalls: string[] = [];

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
vi.mock("@/lib/passes/entitlement", () => ({ hasActivePass }));
vi.mock("@/lib/farah/chat-gate", async () => (await import("./support/route-mocks")).safeChatGate({ farahChatFreeMessagesRemaining, farahChatNextFreeMessageAt }));

const { GET } = await import("@/app/api/farah/history/route");

beforeEach(() => {
  writes.length = 0;
  serviceRoleCalls.length = 0;
  state.unread = [];
  getUser.mockReset().mockResolvedValue({ data: { user: { id: "u-1" } } });
  hasActivePass.mockReset().mockResolvedValue(false);
  farahChatFreeMessagesRemaining.mockReset().mockResolvedValue(2);
  farahChatNextFreeMessageAt.mockReset().mockResolvedValue(null);
});

describe("GET /api/farah/history and the notification read state (current behaviour)", () => {
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
    expect(writes.filter((w) => w.table === "user_notifications")).toHaveLength(0);
  });

  it("never reaches for the service role", async () => {
    state.unread = [{ id: "n1" }];
    await GET();
    expect(serviceRoleCalls).toEqual([]);
  });
});
