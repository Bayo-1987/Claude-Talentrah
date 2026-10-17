/**
 * 0262 and the Postgres rule it is written around: a new enum value cannot be USED in the transaction that adds it (55P04, "unsafe use of new value").
 *
 * RED: a version of the migration whose check casts the new value fails with 55P04. GREEN: the shipped file, whose check reads pg_enum labels as TEXT, passes in the same kind
 * of transaction. Both run against a scratch copy of the enum (a stand-in type holding admin_permission's labels, WITHOUT data_export) so the real type is not touched, and
 * the shipped file's own text is what runs, with only the type name swapped.
 *
 * Local stack only (see tests/support/local-psql.ts, which refuses any other target). Skipped where there is no local database container.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin } from "../support/auth";
import { haveLocalDb, runSql } from "../support/local-psql";

const SHIPPED = readFileSync(join(__dirname, "../../supabase/migrations/0262_data_export_permission.sql"), "utf8");
const PROBE = "public.s5_admin_permission_probe";
const onProbe = (sql: string) => sql.split("public.admin_permission").join(PROBE);

describe.skipIf(!haveLocalDb())("0262: the permission value and the 55P04 rule", () => {
  beforeAll(() => {
    runSql(`drop type if exists ${PROBE} cascade;`);
    const made = runSql(`create type ${PROBE} as enum ('blog', 'people_list');`);
    expect(made.ok, made.stderr).toBe(true);
  });
  afterAll(() => {
    runSql(`drop type if exists ${PROBE} cascade;`);
  });

  it("RED: a check that casts the new value in the same transaction fails with 55P04", () => {
    const unsafe = `begin;\nalter type ${PROBE} add value if not exists 'data_export';\nselect 'data_export'::${PROBE};\ncommit;`;
    const r = runSql(unsafe);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/55P04/);
  });

  it("RED: the same for a comparison against the new value", () => {
    runSql(`drop type if exists ${PROBE} cascade; create type ${PROBE} as enum ('blog', 'people_list');`);
    const r = runSql(`begin;\nalter type ${PROBE} add value if not exists 'data_export';\nselect 1 where 'blog'::${PROBE} <> 'data_export'::${PROBE};\ncommit;`);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/55P04/);
  });

  it("GREEN: the shipped file's own text (type name swapped) passes in one transaction", () => {
    runSql(`drop type if exists ${PROBE} cascade; create type ${PROBE} as enum ('blog', 'people_list');`);
    const r = runSql(`begin;\n${onProbe(SHIPPED)}\ncommit;\nselect string_agg(enumlabel::text, ',' order by enumsortorder) from pg_enum where enumtypid = '${PROBE}'::regtype;`);
    expect(r.ok, r.stderr).toBe(true);
    expect(r.stdout.trim().split("\n").pop()).toBe("blog,people_list,data_export");
  });

  it("GREEN: and applying it a second time is harmless (add value if not exists)", () => {
    const r = runSql(`begin;\n${onProbe(SHIPPED)}\ncommit;`);
    expect(r.ok, r.stderr).toBe(true);
  });

  it("the shipped file contains no cast, comparison or call that names the new value as an enum", () => {
    const code = SHIPPED.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/'data_export'\s*::/);
    expect(code).not.toMatch(/::\s*(public\.)?admin_permission/);
  });

  it("on the real database: the label exists and no role holds it (granted to nobody)", async () => {
    const r = runSql(`select string_agg(enumlabel::text, ',') from pg_enum where enumtypid = 'public.admin_permission'::regtype and enumlabel = 'data_export';`);
    expect(r.stdout.trim().split("\n").pop()).toBe("data_export");
    const { data, error } = await admin.from("admin_role_permissions").select("role_id, permission");
    expect(error).toBeNull();
    expect((data ?? []).filter((p) => String(p.permission) === "data_export")).toEqual([]);
  });
});
