import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES, NOTIFICATION_PREFERENCE_COLUMNS, type NotificationPreferenceValues } from "@/components/settings/notification-preferences-model";
import { SUMMARY_CATEGORY_COLUMNS, accountDeviceHint, categoriesOn, deviceDisplay, emailIsOn } from "@/components/settings/notification-summary-model";

const values = (over: Partial<NotificationPreferenceValues> = {}): NotificationPreferenceValues => ({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...over });

describe("N of M categories on", () => {
  it("M is six: the three push events, push offers, and the two email switches; the master push switch is not a category", () => {
    expect([...SUMMARY_CATEGORY_COLUMNS].sort()).toEqual(["email_announcements", "email_promotions", "push_application_viewed", "push_match_alert", "push_new_applicant", "push_promotions"]);
    expect(SUMMARY_CATEGORY_COLUMNS).not.toContain("push_enabled");
    for (const c of SUMMARY_CATEGORY_COLUMNS) expect(NOTIFICATION_PREFERENCE_COLUMNS).toContain(c);
  });
  it("counts the switches that are on", () => {
    expect(categoriesOn(values())).toEqual({ on: 1, total: 6 }); // today's defaults: only announcements
    expect(categoriesOn(values({ push_new_applicant: true, push_match_alert: true }))).toEqual({ on: 3, total: 6 });
    expect(categoriesOn(values({ push_new_applicant: true, push_application_viewed: true, push_match_alert: true, push_promotions: true, email_promotions: true, email_announcements: true }))).toEqual({ on: 6, total: 6 });
  });
  it("the master push switch does not change the count", () => {
    expect(categoriesOn(values({ push_enabled: true }))).toEqual(categoriesOn(values({ push_enabled: false })));
  });
});

describe("email on or off", () => {
  it("on when either email switch is on", () => {
    expect(emailIsOn(values({ email_announcements: true, email_promotions: false }))).toBe(true);
    expect(emailIsOn(values({ email_announcements: false, email_promotions: true }))).toBe(true);
    expect(emailIsOn(values({ email_announcements: true, email_promotions: true }))).toBe(true);
  });
  it("off only when both are off", () => {
    expect(emailIsOn(values({ email_announcements: false, email_promotions: false }))).toBe(false);
  });
});

describe("push on this device", () => {
  it("on, off and blocked; every other state, and not knowing yet, reads as off", () => {
    expect(deviceDisplay("on")).toBe("on");
    expect(deviceDisplay("blocked")).toBe("blocked");
    for (const s of ["off", "stale_worker", "needs_install", "unsupported", null] as const) expect(deviceDisplay(s)).toBe("off");
  });
});

describe("the account-versus-device hint under the push toggle", () => {
  it("says nothing until the device state is known", () => {
    expect(accountDeviceHint(true, null)).toBeNull();
    expect(accountDeviceHint(false, null)).toBeNull();
  });
  it("toggle on, device not on: on for the account, not yet on this device", () => {
    for (const s of ["off", "stale_worker", "needs_install", "blocked", "unsupported"] as const) expect(accountDeviceHint(true, s)).toBe("On for your account, but not on this device yet.");
  });
  it("toggle off, device subscribed: says so", () => {
    expect(accountDeviceHint(false, "on")).toBe("This device is still subscribed, but notifications are off for your account.");
  });
  it("toggle and device agree: no hint", () => {
    expect(accountDeviceHint(true, "on")).toBeNull();
    expect(accountDeviceHint(false, "off")).toBeNull();
    expect(accountDeviceHint(false, "blocked")).toBeNull();
  });
});
