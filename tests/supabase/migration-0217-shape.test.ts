/**
 * #594 — migration 0217: a verified listing may carry a deadline note only with a verified-deadline stamp, and a note is at most 600 characters.
 * The behaviour is in tests/rls/scholarship-note-constraints.test.ts (database); this pins the file's shape, with no database.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILE = "supabase/migrations/0217_scholarship_note_rules.sql";
const ROLLBACK = "supabase/rollbacks/0217_scholarship_note_rules.rollback.sql";
const sql = existsSync(FILE) ? readFileSync(FILE, "utf8") : "";
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("0217 shape", () => {
  it("exists, with its exact undo beside it", () => {
    expect(existsSync(FILE)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
  });

  it("adds exactly the two constraints, with the decided predicates", () => {
    expect(code).toMatch(/add constraint scholarships_verified_note_needs_stamp\s+check \(moderation_status <> 'verified' or deadline_note is null or deadline_verified_at is not null\)/);
    expect(code).toMatch(/add constraint scholarships_deadline_note_max_600\s+check \(deadline_note is null or char_length\(deadline_note\) <= 600\)/);
    expect(code.match(/add constraint/g)).toHaveLength(2);
  });

  it("changes nothing else: no drop, no data write, no other table", () => {
    expect(code).not.toMatch(/\b(drop|delete|truncate|insert|update)\b\s/i);
    expect(code.match(/alter table/gi)).toHaveLength(1);
    expect(code).toMatch(/alter table public\.scholarships/);
  });

  it("explains why, and says the data fix comes first", () => {
    expect(sql).toMatch(/#594/);
    expect(sql).toMatch(/data-fixes\/2026-10-03-scholarship-asu-deadline-594\.sql/);
  });

  it("ends with a self-check that fails the migration unless both constraints exist and validated", () => {
    expect(code).toMatch(/convalidated/);
    expect(code).toMatch(/raise exception/);
  });

  it("the rollback drops exactly those two constraints, nothing else", () => {
    const rb = existsSync(ROLLBACK) ? readFileSync(ROLLBACK, "utf8") : "";
    const rbCode = rb.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(rbCode).toMatch(/drop constraint (if exists )?scholarships_verified_note_needs_stamp/);
    expect(rbCode).toMatch(/drop constraint (if exists )?scholarships_deadline_note_max_600/);
    expect(rbCode).not.toMatch(/drop (table|column|function)/i);
  });
});
