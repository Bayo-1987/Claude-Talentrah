/**
 * 0283: the three event categories default to true for new rows, and nothing else changes. The file is three ALTER COLUMN SET DEFAULT statements and no data statement (no stored row is rewritten); the rollback
 * puts false back; the model agrees with the effective defaults (0265 plus 0283) column by column; the master switch and both promotions stay false and announcements stay true.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES, NOTIFICATION_PREFERENCE_COLUMNS } from "@/components/settings/notification-preferences-model";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATION = "supabase/migrations/0283_notification_event_defaults.sql";
const ROLLBACK = "supabase/rollbacks/0283_notification_event_defaults.rollback.sql";
const EVENTS = ["push_new_applicant", "push_application_viewed", "push_match_alert"] as const;
const code = (file: string) => readFileSync(path.join(ROOT, file), "utf8").replace(/^\s*--.*$/gm, "").trim();

describe("migration 0283", () => {
  it("exists, and is exactly one ALTER TABLE on email_preferences with three SET DEFAULT true clauses, one per event column", () => {
    expect(existsSync(path.join(ROOT, MIGRATION))).toBe(true);
    const sql = code(MIGRATION);
    expect(sql.match(/\balter table\b/gi)).toHaveLength(1);
    expect(sql).toMatch(/alter table public\.email_preferences/);
    expect([...sql.matchAll(/alter column (\w+) set default (true|false)/g)].map((m) => [m[1], m[2]])).toEqual(EVENTS.map((c) => [c, "true"]));
  });
  it("changes no stored row: no UPDATE, INSERT, DELETE or TRUNCATE, no new column, no drop", () => {
    const sql = code(MIGRATION);
    for (const word of ["update", "insert", "delete", "truncate", "drop", "add column", "create"]) expect(sql, word).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
  });
  it("touches none of the other four columns", () => {
    const sql = code(MIGRATION);
    for (const column of ["push_enabled", "push_promotions", "email_promotions", "email_announcements"]) expect(sql, column).not.toContain(column);
  });
  it("its rollback sets the same three defaults back to false and changes no row either", () => {
    expect(existsSync(path.join(ROOT, ROLLBACK))).toBe(true);
    const sql = code(ROLLBACK);
    expect([...sql.matchAll(/alter column (\w+) set default (true|false)/g)].map((m) => [m[1], m[2]])).toEqual(EVENTS.map((c) => [c, "false"]));
    for (const word of ["update", "insert", "delete", "truncate", "drop"]) expect(sql, word).not.toMatch(new RegExp(`\\b${word}\\b`, "i"));
  });
  it("is the only migration after 0265 that sets these defaults, and the rollback is not inside the migrations directory", () => {
    const dir = path.join(ROOT, "supabase/migrations");
    const setters = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f) && f > "0265_" && /alter column (push_|email_)\w+ set default/.test(code(`supabase/migrations/${f}`)));
    expect(setters).toEqual(["0283_notification_event_defaults.sql"]);
    expect(readdirSync(dir).filter((f) => /rollback/i.test(f))).toEqual([]);
  });
});

describe("the model against the effective database defaults (0265, then 0283)", () => {
  const base = readFileSync(path.join(ROOT, "supabase/migrations/0265_notifications_and_admin_messaging.sql"), "utf8");
  const effective = (column: string) => {
    let value = new RegExp(`add column if not exists ${column} boolean not null default (true|false)`).exec(base)![1] === "true";
    for (const a of code(MIGRATION).matchAll(new RegExp(`alter column ${column} set default (true|false)`, "g"))) value = a[1] === "true";
    return value;
  };
  it("every column agrees", () => {
    for (const column of NOTIFICATION_PREFERENCE_COLUMNS) expect(DEFAULT_NOTIFICATION_PREFERENCES[column], column).toBe(effective(column));
  });
  it("the three events are on; the master switch and both promotions are off; announcements are on", () => {
    for (const column of EVENTS) expect(effective(column), column).toBe(true);
    for (const column of ["push_enabled", "push_promotions", "email_promotions"] as const) {
      expect(effective(column), `database ${column}`).toBe(false);
      expect(DEFAULT_NOTIFICATION_PREFERENCES[column], `model ${column}`).toBe(false);
    }
    expect(effective("email_announcements")).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFERENCES.email_announcements).toBe(true);
  });
});
