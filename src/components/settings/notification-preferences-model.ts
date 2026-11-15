/**
 * The notification preferences, as plain data (U6). The seven switches are columns of `email_preferences` (0265): a master push switch, one push switch per event, the two kinds of mass e-mail the admin
 * messages send, and push for offers.
 *
 * DEFAULTS, and why they are here: promotions are OFF unless the person turns them on (consent, never a default), announcements are ON (service notices, with unsubscribe), and every push switch is OFF (a person
 * opts in on a device). They mirror the column defaults in migration 0265; tests/notifications/preferences-model.test.ts reads that migration and fails if the two ever disagree. The screen shows the stored
 * row when there is one, and these values when there is not.
 */
export const NOTIFICATION_PREFERENCE_COLUMNS = [
  "push_enabled",
  "push_new_applicant",
  "push_application_viewed",
  "push_match_alert",
  "push_promotions",
  "email_promotions",
  "email_announcements",
] as const;

export type NotificationPreferenceColumn = (typeof NOTIFICATION_PREFERENCE_COLUMNS)[number];
export type NotificationPreferenceValues = Record<NotificationPreferenceColumn, boolean>;

export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<NotificationPreferenceValues> = Object.freeze({
  push_enabled: false,
  push_new_applicant: false,
  push_application_viewed: false,
  push_match_alert: false,
  push_promotions: false,
  email_promotions: false,
  email_announcements: true,
});

export function isPreferenceColumn(value: unknown): value is NotificationPreferenceColumn {
  return typeof value === "string" && (NOTIFICATION_PREFERENCE_COLUMNS as readonly string[]).includes(value);
}

/** The stored row laid over the defaults: anything missing or not a boolean is the default for that column. */
export function withDefaults(row: Partial<Record<string, unknown>> | null | undefined): NotificationPreferenceValues {
  const out = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  for (const column of NOTIFICATION_PREFERENCE_COLUMNS) {
    const stored = row?.[column];
    if (typeof stored === "boolean") out[column] = stored;
  }
  return out;
}

/** The columns that only do something once the master push switch is on. */
export const PUSH_DEPENDENT_COLUMNS: readonly NotificationPreferenceColumn[] = ["push_new_applicant", "push_application_viewed", "push_match_alert", "push_promotions"];

/** The settings page links to the notification preferences only while the master flag is on, so with every flag OFF the page is exactly what it was. */
export function showNotificationsLink(masterFlagOn: boolean): boolean {
  return masterFlagOn === true;
}
