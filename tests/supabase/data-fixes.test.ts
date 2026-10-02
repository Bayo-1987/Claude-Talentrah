/**
 * supabase/data-fixes/ — one-off production DATA fixes (as opposed to schema migrations).
 *
 * A data fix edits specific production rows, so it must not live in supabase/migrations/: CI replays every migration on an empty
 * database, where those rows do not exist and the exactly-one-row assertions below would (correctly) fail. These rules are what
 * keeps a data fix from half-applying or being replayed by accident:
 *   - named by date, never by migration number;
 *   - every UPDATE sits in the one APPLY DO block and is followed by a row-count assertion that raises unless exactly one row changed
 *     (a DO block is atomic, so one miss rolls back the whole fix);
 *   - the file carries its own ROLLBACK block, guarded by the new values.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/data-fixes";
const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".sql")) : [];

describe("supabase/data-fixes", () => {
  it("exists, with a README that explains why these are not migrations", () => {
    expect(existsSync(join(DIR, "README.md"))).toBe(true);
    const readme = readFileSync(join(DIR, "README.md"), "utf8");
    expect(readme).toMatch(/not replayed|NOT replayed/);
    expect(readme).toMatch(/READ ONLY|dry run/i);
  });

  it("holds the 2026-10-02 scholarship close-times fix", () => {
    expect(files).toContain("2026-10-02-scholarship-close-times.sql");
  });

  it.each(files)("%s is named by date and takes no migration number", (f) => {
    expect(f).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.sql$/);
    expect(f).not.toMatch(/^\d{4}_/);
  });

  it.each(files)("%s: every UPDATE in the APPLY block is followed by an exactly-one-row assertion", (f) => {
    const sql = readFileSync(join(DIR, f), "utf8");
    const apply = sql.split("do $apply$")[1]?.split("$apply$;")[0];
    expect(apply, "an APPLY DO block").toBeTruthy();
    const updates = apply!.match(/^\s*update public\./gm) ?? [];
    const diagnostics = apply!.match(/get diagnostics n = row_count;/g) ?? [];
    const raises = apply!.match(/if n <> 1 then raise exception/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    expect(diagnostics.length).toBe(updates.length);
    expect(raises.length).toBe(updates.length);
  });

  it.each(files)("%s: every UPDATE is guarded by a WHERE on its row id", (f) => {
    const sql = readFileSync(join(DIR, f), "utf8");
    const apply = sql.split("do $apply$")[1]?.split("$apply$;")[0] ?? "";
    const updates = apply.split(/^\s*update public\./m).slice(1);
    for (const u of updates) {
      // a note's own text can contain ";", so the statement ends at its row-count assertion, not at the first semicolon
      const stmt = u.split("get diagnostics")[0];
      expect(stmt, "an UPDATE with a WHERE on id").toMatch(/where id = '[0-9a-f-]{36}'/);
    }
  });

  it.each(files)("%s carries a ROLLBACK block that restores the old state", (f) => {
    const sql = readFileSync(join(DIR, f), "utf8");
    expect(sql).toMatch(/ROLLBACK \(not run/);
    expect(sql).toMatch(/do \$rollback\$/);
  });

  it("is not picked up as a migration (the migrations directory holds no data-fix file)", () => {
    const migrations = readdirSync("supabase/migrations");
    expect(migrations.filter((m) => /scholarship-close-times/.test(m))).toEqual([]);
  });
});
