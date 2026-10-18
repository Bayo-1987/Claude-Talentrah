/**
 * 0262 is ONE statement, and 0263 stays a separate file (owner decision, 18 Oct 2026). No database needed.
 *
 *   T-Z1  after stripping comments and whitespace, 0262 holds exactly one statement: `alter type public.admin_permission add value if not exists 'data_export'`.
 *   T-Z3a the 0262 file contains none of 0263's objects.
 *   T-Z3b 0263 never casts or compares 'data_export' to public.admin_permission (it could not: Postgres refuses with 55P04 in the transaction that added the value). The detector is shown
 *         catching a cast and a comparison in a temporary copy, and passing the real file.
 * The database side (applying twice, applying both files in one transaction, the two catalog-text checks) is in data-export-permission-enum.test.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
export const read = (name: string) => readFileSync(join(ROOT, "supabase/migrations", name), "utf8");
const F0262 = "0262_data_export_permission.sql";
const F0263 = "0263_data_export_files.sql";

/** The SQL with `--` comments removed (outside string literals) and whitespace collapsed. */
export function code(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits on semicolons that are not inside a dollar-quoted body ($tag$ ... $tag$), so a `do` block counts as one statement. */
export function statements(sql: string): string[] {
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

/** True when the SQL casts, compares or passes 'data_export' as the admin_permission type. Text-only reads (::text, pg_enum labels as text) do not count. */
export function usesNewValueAsEnum(sql: string): boolean {
  const c = code(sql);
  return /'data_export'\s*::\s*(public\.)?admin_permission/i.test(c) || /cast\s*\(\s*'data_export'\s+as\s+(public\.)?admin_permission/i.test(c) || /admin_permission\s*'data_export'/i.test(c) || /(permission|admin_permission)\s*(=|<>|!=|in)\s*\(?\s*'data_export'/i.test(c.replace(/::text/gi, "::TEXTOK").replace(/permission::TEXTOK\s*(=|<>|!=)\s*'data_export'/gi, ""));
}

describe("T-Z1: 0262 is exactly one statement", () => {
  it("holds one statement, and it is the alter type ... add value if not exists 'data_export'", () => {
    const s = statements(read(F0262));
    expect(s).toEqual(["alter type public.admin_permission add value if not exists 'data_export'"]);
  });

  it("the statement parser counts a do block or a second statement (so the test above can fail)", () => {
    expect(statements("alter type public.admin_permission add value if not exists 'data_export'; do $c$ begin null; end $c$;")).toHaveLength(2);
    expect(statements("-- note\nalter type public.admin_permission add value if not exists 'data_export';\n-- tail")).toHaveLength(1);
  });
});

describe("T-Z3a: 0262 contains none of 0263's objects", () => {
  const c = code(read(F0262)).toLowerCase();
  it.each(["create table", "create function", "create or replace function", "create index", "create unique index", "storage.buckets", "data_export_files", "claim_data_export_download", "grant ", "revoke ", "insert into", "alter table"])("has no %s", (needle) => {
    expect(c).not.toContain(needle);
  });

  it("and 0263 is a separate file that does not repeat the enum statement", () => {
    expect(F0262).not.toBe(F0263);
    expect(code(read(F0263)).toLowerCase()).not.toContain("alter type public.admin_permission");
  });
});

describe("T-Z3b: 0263 never casts or compares 'data_export' to admin_permission", () => {
  it("the real 0263 passes", () => {
    expect(usesNewValueAsEnum(read(F0263))).toBe(false);
  });

  it("the detector catches a cast, a typed literal and a comparison in a temporary copy (red-first)", () => {
    const real = read(F0263);
    for (const bad of [
      "select 'data_export'::public.admin_permission;",
      "select cast('data_export' as public.admin_permission);",
      "select 1 where p.permission = 'data_export';",
      "select 1 where p.permission in ('data_export');",
      "select admin_permission 'data_export';",
    ]) {
      expect(usesNewValueAsEnum(`${real}\n${bad}`), bad).toBe(true);
    }
  });

  it("a read as TEXT is fine (that is how the checks read it)", () => {
    expect(usesNewValueAsEnum("select 1 where p.permission::text = 'data_export';")).toBe(false);
    expect(usesNewValueAsEnum("select 'data_export' = any (array_agg(e.enumlabel::text));")).toBe(false);
  });
});
