/**
 * N1: /settings/notifications has a Back link to /settings. The real page is rendered with its session and preference dependencies replaced; the link is a real 44px link, and the route still does not exist with
 * the master flag off.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ master: true }));
vi.mock("@/lib/auth/require-user", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/require-user")>()), requireUser: async () => ({ user: { id: "u1" }, profile: {} }) }));
vi.mock("@/app/(app)/settings/notification-deps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/(app)/settings/notification-deps")>()),
  realPreferenceDeps: () => ({
    sessionUserId: async () => "u1",
    flagOn: async (key: string) => (key === "notifications_master" ? state.master : true),
    read: async () => null,
    write: async () => true,
  }),
}));

import NotificationSettingsPage from "@/app/(app)/settings/notifications/page";

beforeEach(() => void (state.master = true));

describe("the Back link on the notification settings page", () => {
  it("is a link to /settings, at least 44px tall, above the heading", async () => {
    const html = renderToStaticMarkup(await NotificationSettingsPage());
    const link = /<a [^>]*href="\/settings"[^>]*>([^<]*)<\/a>/.exec(html);
    expect(link, "no link to /settings").not.toBeNull();
    expect(link![0]).toMatch(/min-h-\[44px\]/);
    expect(link![1]).toMatch(/Back to settings/);
    expect(html.indexOf('href="/settings"')).toBeLessThan(html.indexOf("<h1"));
  });
  it("there is exactly one such link", async () => {
    const html = renderToStaticMarkup(await NotificationSettingsPage());
    expect(html.match(/href="\/settings"/g)).toHaveLength(1);
  });
  it("with the master flag off the route still does not exist", async () => {
    state.master = false;
    await expect(NotificationSettingsPage()).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK|NEXT_NOT_FOUND/);
  });
});
