/**
 * 0276 is ONE statement and nothing else (the 0262 rule), its rollback only removes role grants as text, and the value is granted to nobody by any migration. No database needed.
 * The database side (applying twice, the two catalog-text checks) is in jobs-import-permission-enum.test.ts.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The SQL with `--` comments removed and whitespace collapsed (the same helpers tests/supabase/data-export-permission-statement.test.ts uses). */
function code(sql: string): string {
  return sql.split("\n").map((l) => l.replace(/--.*$/, "")).join(" ").replace(/\s+/g, " ").trim();
}
/** Splits on semicolons outside a dollar-quoted body, so a `do` block counts as one statement. */
function statements(sql: string): string[] {
  const c = code(sql);
  const out: string[] = [];
  let cur = "";
  let tag: string | null = null;
  for (let i = 0; i < c.length; i++) {
    if (tag === null) {
      const m = /^\$[A-Za-z_]*\$/.exec(c.slice(i));
      if (m) {
        tag = m[0];
        cur += tag;
        i += tag.length - 1;
        continue;
      }
      if (c[i] === ";") {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
        continue;
      }
    } else if (c.startsWith(tag, i)) {
      cur += tag;
      i += tag.length - 1;
      tag = null;
      continue;
    }
    cur += c[i];
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const ROOT = join(__dirname, "../..");
const MIGRATIONS = join(ROOT, "supabase/migrations");
const F0276 = "0276_jobs_import_permission.sql";

describe("0276 is exactly one statement", () => {
  it("holds one statement: alter type public.admin_permission add value if not exists 'jobs_import'", () => {
    expect(statements(readFileSync(join(MIGRATIONS, F0276), "utf8"))).toEqual(["alter type public.admin_permission add value if not exists 'jobs_import'"]);
  });

  it("holds none of the things a grant would need (no table, function, grant, insert into admin_role_permissions)", () => {
    const c = code(readFileSync(join(MIGRATIONS, F0276), "utf8")).toLowerCase();
    for (const needle of ["create ", "grant ", "revoke ", "insert ", "admin_role_permissions", "update ", "delete "]) expect(c, needle).not.toContain(needle);
  });
});

describe("granted to nobody: no migration hands the value to a role", () => {
  it("no migration other than the one that adds it names 'jobs_import' at all", () => {
    for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql") && n !== F0276)) {
      expect(readFileSync(join(MIGRATIONS, f), "utf8"), f).not.toContain("jobs_import");
    }
  });
});

describe("the rollback", () => {
  const sql = readFileSync(join(ROOT, "supabase/rollbacks/0276_jobs_import_permission.rollback.sql"), "utf8");
  it("removes role grants of it, compared as text, and never casts the value to the enum type", () => {
    expect(statements(sql)).toEqual(["delete from public.admin_role_permissions where permission::text = 'jobs_import'"]);
  });
});
