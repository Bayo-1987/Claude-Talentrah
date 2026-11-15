/**
 * The defaults of the notification preferences: promotions OFF, announcements ON, every push switch OFF (U6). Killed mutant: M-promotions-default-on (a promotions default flipped to true).
 * The constant is also checked against the column defaults of migration 0265, so the screen and the database cannot drift apart.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_COLUMNS,
  PUSH_DEPENDENT_COLUMNS,
  isPreferenceColumn,
  showNotificationsLink,
  withDefaults,
} from "@/components/settings/notification-preferences-model";

describe("the defaults", () => {
  it("promotions default OFF (push and e-mail), announcements default ON, every push switch OFF", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.push_promotions).toBe(false);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.email_promotions).toBe(false);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.email_announcements).toBe(true);
    for (const column of ["push_enabled", "push_new_applicant", "push_application_viewed", "push_match_alert"] as const) expect(DEFAULT_NOTIFICATION_PREFERENCES[column], column).toBe(false);
  });
  it("is exactly the seven columns and cannot be changed at run time", () => {
    expect([...NOTIFICATION_PREFERENCE_COLUMNS].sort()).toEqual(["email_announcements", "email_promotions", "push_application_viewed", "push_enabled", "push_match_alert", "push_new_applicant", "push_promotions"]);
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES).sort()).toEqual([...NOTIFICATION_PREFERENCE_COLUMNS].sort());
    expect(Object.isFrozen(DEFAULT_NOTIFICATION_PREFERENCES)).toBe(true);
  });
  it("agrees with the column defaults of migration 0265", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../supabase/migrations/0265_notifications_and_admin_messaging.sql"), "utf8");
    for (const column of NOTIFICATION_PREFERENCE_COLUMNS) {
      const m = new RegExp(`add column if not exists ${column} boolean not null default (true|false)`).exec(sql);
      expect(m, `${column} is not declared in 0265`).not.toBeNull();
      expect(DEFAULT_NOTIFICATION_PREFERENCES[column], `${column}: the screen's default differs from the database's`).toBe(m![1] === "true");
    }
  });
});

describe("withDefaults", () => {
  it("no row at all is the defaults", () => {
    expect(withDefaults(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    expect(withDefaults(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });
  it("a stored boolean wins, a missing or non-boolean value is the default for that column", () => {
    const out = withDefaults({ push_enabled: true, email_announcements: false, email_promotions: "yes", push_match_alert: null, unrelated: true });
    expect(out.push_enabled).toBe(true);
    expect(out.email_announcements).toBe(false);
    expect(out.email_promotions).toBe(false);
    expect(out.push_match_alert).toBe(false);
    expect("unrelated" in out).toBe(false);
  });
});

describe("the small rules", () => {
  it("only the seven columns are preference columns", () => {
    for (const c of NOTIFICATION_PREFERENCE_COLUMNS) expect(isPreferenceColumn(c)).toBe(true);
    for (const bad of ["job_match_digest", "user_id", "unsubscribe_token", "__proto__", "", 7, null, undefined, {}]) expect(isPreferenceColumn(bad)).toBe(false);
  });
  it("the push-dependent columns are the three events and push promotions, not the master and not e-mail", () => {
    expect([...PUSH_DEPENDENT_COLUMNS].sort()).toEqual(["push_application_viewed", "push_match_alert", "push_new_applicant", "push_promotions"]);
  });
  it("the settings page links to the notification preferences only with the master flag on", () => {
    expect(showNotificationsLink(false)).toBe(false);
    expect(showNotificationsLink(true)).toBe(true);
    expect(showNotificationsLink(undefined as unknown as boolean)).toBe(false);
  });
});
