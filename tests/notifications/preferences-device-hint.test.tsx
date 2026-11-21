/**
 * N6: the master push toggle reads the SAVED ACCOUNT value only; the line under it can come from the device. The two can disagree, and when they do the screen says so without moving the toggle.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationPreferencesView } from "@/components/settings/notification-preferences";
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferenceValues } from "@/components/settings/notification-preferences-model";
import type { PushState } from "@/lib/pwa/push/client";

const render = (values: Partial<NotificationPreferenceValues>, deviceState?: PushState | null) =>
  renderToStaticMarkup(
    <NotificationPreferencesView values={{ ...DEFAULT_NOTIFICATION_PREFERENCES, ...values }} onToggle={() => undefined} busy={null} notes={{}} error={null} optIn={<span />} deviceState={deviceState} />,
  );
const masterChecked = (html: string) => /<button[^>]*role="switch"[^>]*aria-checked="(true|false)"[^>]*aria-label="Push notifications on this device"|<button[^>]*role="switch"[^>]*aria-label="Push notifications on this device"[^>]*aria-checked="(true|false)"/.exec(html)?.slice(1).find(Boolean);

describe("the toggle and the device", () => {
  it("the toggle shows the saved value whatever the device says", () => {
    for (const device of ["on", "off", "stale_worker", "blocked", "needs_install", null, undefined] as const) {
      expect(masterChecked(render({ push_enabled: true }, device)), String(device)).toBe("true");
      expect(masterChecked(render({ push_enabled: false }, device)), String(device)).toBe("false");
    }
  });
  it("saved on, device not on (a worker that has not updated yet): says so, next to the line that asks to reopen the app", () => {
    const html = render({ push_enabled: true }, "stale_worker");
    expect(html).toMatch(/On for your account, but not on this device yet\./);
    expect(html).toContain('data-testid="push-device-hint"');
  });
  it("saved off, device subscribed: says so", () => {
    expect(render({ push_enabled: false }, "on")).toMatch(/This device is still subscribed, but notifications are off for your account\./);
  });
  it("no hint while the device state is unknown, when they agree, or when no device state is passed at all (the markup is then what it was)", () => {
    expect(render({ push_enabled: true }, null)).not.toContain("push-device-hint");
    expect(render({ push_enabled: true }, "on")).not.toContain("push-device-hint");
    expect(render({ push_enabled: false }, "off")).not.toContain("push-device-hint");
    expect(render({ push_enabled: true }, undefined)).not.toContain("push-device-hint");
  });
});
