/**
 * The Settings link to the notification preferences: shown only with the master flag ON, and a flag that cannot be read leaves Settings exactly as it was (U6).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { flag: boolean | "throws" } = { flag: false };
vi.mock("@/lib/flags/read", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/flags/read")>()),
  isFeatureEnabled: async () => {
    if (state.flag === "throws") throw new Error("no database");
    return state.flag;
  },
}));

import { NotificationSettingsLink, readNotificationsLinkFlag } from "@/components/settings/notification-settings-link";

beforeEach(() => {
  state.flag = false;
});

describe("the Settings link", () => {
  it("flag OFF: not shown", async () => {
    expect(await readNotificationsLinkFlag()).toBe(false);
    expect(NotificationSettingsLink({ show: false })).toBeNull();
  });
  it("flag unreadable: not shown and nothing throws", async () => {
    state.flag = "throws";
    expect(await readNotificationsLinkFlag()).toBe(false);
  });
  it("flag ON: shown, one link to the preferences page", async () => {
    state.flag = true;
    expect(await readNotificationsLinkFlag()).toBe(true);
    const el = NotificationSettingsLink({ show: true }) as { props: { href: string } } | null;
    expect(el?.props.href).toBe("/settings/notifications");
  });
});
