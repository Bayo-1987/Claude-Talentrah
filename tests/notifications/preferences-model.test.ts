/**
 * The defaults of the notification preferences: promotions OFF, announcements ON, the master push switch OFF and the three event switches ON (U6, event defaults changed by 0283). Killed mutant: M-promotions-default-on (a promotions default flipped to true).
 * The constant is also checked against the EFFECTIVE column defaults (migration 0265 plus every later ALTER ... SET DEFAULT), so the screen and the database cannot drift apart.
 */
import { readFileSync, readdirSync } from "node:fs";
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
  it("promotions default OFF (push and e-mail), announcements default ON, the master push switch OFF, the three event switches ON", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES.push_promotions).toBe(false);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.email_promotions).toBe(false);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.email_announcements).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.push_enabled).toBe(false);
    for (const column of ["push_new_applicant", "push_application_viewed", "push_match_alert"] as const) expect(DEFAULT_NOTIFICATION_PREFERENCES[column], column).toBe(true);
  });
  it("is exactly the seven columns and cannot be changed at run time", () => {
    expect([...NOTIFICATION_PREFERENCE_COLUMNS].sort()).toEqual(["email_announcements", "email_promotions", "push_application_viewed", "push_enabled", "push_match_alert", "push_new_applicant", "push_promotions"]);
    expect(Object.keys(DEFAULT_NOTIFICATION_PREFERENCES).sort()).toEqual([...NOTIFICATION_PREFERENCE_COLUMNS].sort());
    expect(Object.isFrozen(DEFAULT_NOTIFICATION_PREFERENCES)).toBe(true);
  });
  it("agrees with the effective column defaults: migration 0265, then every later ALTER ... SET DEFAULT in migration order", () => {
    const dir = path.resolve(__dirname, "../../supabase/migrations");
    const sql = readFileSync(path.join(dir, "0265_notifications_and_admin_messaging.sql"), "utf8");
    const later = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f) && f > "0265_").sort().map((f) => readFileSync(path.join(dir, f), "utf8").replace(/^\s*--.*$/gm, ""));
    for (const column of NOTIFICATION_PREFERENCE_COLUMNS) {
      const m = new RegExp(`add column if not exists ${column} boolean not null default (true|false)`).exec(sql);
      expect(m, `${column} is not declared in 0265`).not.toBeNull();
      let effective = m![1] === "true";
      for (const file of later) for (const a of file.matchAll(new RegExp(`alter column ${column} set default (true|false)`, "g"))) effective = a[1] === "true";
      expect(DEFAULT_NOTIFICATION_PREFERENCES[column], `${column}: the screen's default differs from the database's`).toBe(effective);
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
    expect(out.push_match_alert).toBe(true);
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
