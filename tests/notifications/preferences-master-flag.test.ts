/**
 * The preferences' master flag is read the way the bell reads it: inboxEnabled(), per request, failing closed. When the flag read throws, the real dependencies answer "off" and the settings action
 * writes nothing (U6). The push sender key keeps its own read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { flag: "throws" as boolean | "throws", calls: [] as string[], writes: 0 };
vi.mock("@/lib/flags/read", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/flags/read")>()),
  isFeatureEnabled: async (key: string) => {
    state.calls.push(key);
    if (state.flag === "throws") throw new Error("no database");
    return state.flag;
  },
}));
vi.mock("@/lib/supabase/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/server")>()),
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "session-user" } } }) } }),
}));
vi.mock("@/lib/supabase/service-role", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/service-role")>()),
  createServiceRoleClient: () => ({
    from: () => ({
      update: () => {
        state.writes += 1;
        return { eq: () => ({ select: async () => ({ data: [{ user_id: "session-user" }], error: null }) }) };
      },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    }),
  }),
}));

import { realPreferenceDeps } from "@/app/(app)/settings/notification-deps";
import { setNotificationPreferenceAction } from "@/app/(app)/settings/notification-actions";

beforeEach(() => {
  state.flag = "throws";
  state.calls = [];
  state.writes = 0;
});

describe("the master flag in the real preference dependencies", () => {
  it("a flag read that throws is OFF, not an error", async () => {
    await expect(realPreferenceDeps().flagOn("notifications_master")).resolves.toBe(false);
  });
  it("the settings action does nothing when the flag read throws: it answers 'unavailable' and writes nothing", async () => {
    expect(await setNotificationPreferenceAction("push_enabled", true)).toEqual({ ok: false, error: "unavailable" });
    expect(state.writes).toBe(0);
  });
  it("flag ON: the action writes once", async () => {
    state.flag = true;
    expect(await setNotificationPreferenceAction("push_enabled", true)).toMatchObject({ ok: true });
    expect(state.writes).toBe(1);
  });
  it("the push sender key is still read on its own", async () => {
    state.flag = true;
    await realPreferenceDeps().flagOn("push_sender");
    expect(state.calls).toContain("push_sender");
  });
});
