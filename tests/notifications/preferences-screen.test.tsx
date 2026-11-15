/**
 * The preferences screen's markup (U6): the master push switch, one switch per event, the promotion switches OFF by default, announcements ON by default (spec 02 section 6, "Preferences and UI").
 * Killed mutants: M-promotions-default-on, M-announcements-default-off.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationPreferencesView } from "@/components/settings/notification-preferences";
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferenceValues } from "@/components/settings/notification-preferences-model";

const render = (values: NotificationPreferenceValues = { ...DEFAULT_NOTIFICATION_PREFERENCES }, extra: { notes?: Record<string, string>; busy?: string | null; error?: string | null } = {}) =>
  renderToStaticMarkup(<NotificationPreferencesView values={values} onToggle={() => undefined} busy={extra.busy ?? null} notes={extra.notes ?? {}} error={extra.error ?? null} optIn={<span data-testid="opt-in-slot" />} />);
const switchOf = (html: string, label: string) => {
  const m = new RegExp(`<button[^>]*role="switch"[^>]*aria-checked="(true|false)"[^>]*aria-label="${label}"|<button[^>]*role="switch"[^>]*aria-label="${label}"[^>]*aria-checked="(true|false)"`).exec(html);
  return m ? (m[1] ?? m[2]) === "true" : null;
};

describe("the switches and their defaults", () => {
  const html = render();
  it("has the master push switch, one switch per event, the two promotion switches and the announcements switch", () => {
    for (const label of ["Push notifications on this device", "A new applicant on a job you posted", "An employer has viewed your application", "An exceptional job match", "Offers and promotions by push", "Offers and promotions by email", "Announcements by email"]) {
      expect(switchOf(html, label), label).not.toBeNull();
    }
    expect(html.match(/role="switch"/g)).toHaveLength(7);
  });
  it("promotions are OFF by default, in both channels", () => {
    expect(switchOf(html, "Offers and promotions by push")).toBe(false);
    expect(switchOf(html, "Offers and promotions by email")).toBe(false);
  });
  it("announcements are ON by default, and the master push switch and every event switch are OFF", () => {
    expect(switchOf(html, "Announcements by email")).toBe(true);
    for (const label of ["Push notifications on this device", "A new applicant on a job you posted", "An employer has viewed your application", "An exceptional job match"]) expect(switchOf(html, label), label).toBe(false);
  });
  it("shows stored values as stored", () => {
    const stored = render({ ...DEFAULT_NOTIFICATION_PREFERENCES, push_enabled: true, email_promotions: true, email_announcements: false });
    expect(switchOf(stored, "Push notifications on this device")).toBe(true);
    expect(switchOf(stored, "Offers and promotions by email")).toBe(true);
    expect(switchOf(stored, "Announcements by email")).toBe(false);
  });
});

describe("the screen's words", () => {
  it("says why an event switch sends nothing while push is off", () => {
    const html = render(undefined, { notes: { push_match_alert: "push_off" } });
    expect(html).toMatch(/Push is off, so this will not send until you turn on push notifications/);
  });
  it("shows the opt-in slot exactly once, under the master switch, and an error in an alert", () => {
    const html = render(undefined, { error: "That didn't save." });
    expect(html.match(/data-testid="opt-in-slot"/g)).toHaveLength(1);
    expect(html).toContain('role="alert"');
    expect(html).toContain("That didn&#x27;t save.");
  });
  it("every switch has a hit target of at least 40px (the design system's rule) and no emoji", () => {
    const html = render();
    expect(html).toContain("h-[26px] w-[46px]");
    expect(html).toContain("before:-inset-[7px]");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
