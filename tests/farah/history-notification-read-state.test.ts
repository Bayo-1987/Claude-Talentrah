/**
 * NOTIF-FARAH-HISTORY-1. The first commit of this branch pinned the OLD behaviour (the route reported the unread state and then marked every unread row read; green on unchanged code). This file now holds the
 * deliberate successors, which fail against the old route and pass against the new one: the route never writes user_notifications, and reports unread on every call while unread rows exist.
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
vi.mock("@/lib/farah/chat-gate", async () => (await import("./support/route-mocks")).safeChatGate({ checkFarahChatAllowance, commitFarahChatAllowance, farahChatFreeMessagesRemaining, farahChatNextFreeMessageAt }));

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

describe("GET /api/farah/history and the notification read state (NOTIF-FARAH-HISTORY-1: the bell owns read state)", () => {
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
