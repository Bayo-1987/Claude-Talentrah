import type { PushState } from "@/lib/pwa/push/client";
import type { NotificationPreferenceColumn, NotificationPreferenceValues } from "./notification-preferences-model";

/**
 * The Settings summary, as plain data. The categories are the six switches a person chooses between: the three push events, push offers, and the two email switches. The master push switch is the
 * device-level gate, not a category, so it is not counted.
 */
export const SUMMARY_CATEGORY_COLUMNS = [
  "push_new_applicant",
  "push_application_viewed",
  "push_match_alert",
  "push_promotions",
  "email_promotions",
  "email_announcements",
] as const satisfies readonly NotificationPreferenceColumn[];

export function categoriesOn(values: NotificationPreferenceValues): { on: number; total: number } {
  return { on: SUMMARY_CATEGORY_COLUMNS.filter((column) => values[column] === true).length, total: SUMMARY_CATEGORY_COLUMNS.length };
}

/** Email is "on" when either email switch is on. */
export function emailIsOn(values: NotificationPreferenceValues): boolean {
  return values.email_announcements === true || values.email_promotions === true;
}

export type DevicePushDisplay = "on" | "off" | "blocked";

/** The device's push state in three words. Every state that is not "on" or "blocked" reads as off; the screen under it says why (reopen the app, add to Home Screen, unsupported). */
export function deviceDisplay(state: PushState | null): DevicePushDisplay {
  if (state === "on") return "on";
  if (state === "blocked") return "blocked";
  return "off";
}

/**
 * What the screen says when the saved account switch and this device disagree. The toggle shows the saved value only; it never reads the device, and tapping it only saves that value. Nothing
 * is said until the device state is known, or when the two agree.
 */
export function accountDeviceHint(savedOn: boolean, device: PushState | null): string | null {
  if (device === null) return null;
  if (savedOn && device !== "on") return "On for your account, but not on this device yet.";
  if (!savedOn && device === "on") return "This device is still subscribed, but notifications are off for your account.";
  return null;
}
