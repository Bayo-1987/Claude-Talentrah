/**
 * 0262 and the Postgres rule it is written around: a new enum value cannot be USED in the transaction that adds it (55P04, "unsafe use of new value").
 *
 * 0262 is ONE statement (tests/supabase/data-export-permission-statement.test.ts holds that, without a database). This file is the database side, on the local stack only
 * (tests/support/local-psql.ts refuses any other target; skipped where there is no local database container):
 *
 *   55P04 RED/GREEN  a cast or comparison of the new value in the same transaction fails 55P04; the shipped file's own text passes. Both run against a scratch copy of the enum (a stand-in
 *                    type holding admin_permission's labels, WITHOUT data_export), with only the type name swapped, so the real type is not touched.
 *   T-Z2             the migration text is run TWICE, each time inside its own transaction, the way the migration runner applies a file: no error, exactly one `data_export` label.
 *   T-Z3c            0262 and 0263 applied in ONE transaction. RECORDED RESULT: it succeeds today, because 0263 never names the value as the enum type. The same transaction with a cast of the
 *                    value appended to 0263 fails with 55P04, which is the hazard: if 0263 ever uses the value, this test goes red here, before any hosted run. (Rolled back at the end.)
 *   THE TWO CATALOG-TEXT CHECKS, the exact SQL S3-21 copies into the hosted 0262 post-check. They read labels as TEXT and never cast or compare the new value to the enum type.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin } from "../support/auth";
import { haveLocalDb, runSql } from "../support/local-psql";

const read = (name: string) => readFileSync(join(__dirname, "../../supabase/migrations", name), "utf8");
const SHIPPED = read("0262_data_export_permission.sql");
const F0263 = read("0263_data_export_files.sql");
const PROBE = "public.s5_admin_permission_probe";
const onProbe = (sql: string) => sql.split("public.admin_permission").join(PROBE);
const fresh = () => runSql(`drop type if exists ${PROBE} cascade; create type ${PROBE} as enum ('blog', 'people_list');`);
const last = (out: string) => out.trim().split("\n").pop();

/** CHECK 1 (the label is present): reads pg_enum labels as text. Expected: t */
export const CHECK_LABEL_PRESENT = `select exists (select 1 from pg_catalog.pg_enum e where e.enumtypid = 'public.admin_permission'::regtype and e.enumlabel::text = 'data_export') as label_present;`;
/** CHECK 2 (granted to nobody): compares the permission column as text. Expected: t */
export const CHECK_GRANTED_TO_NOBODY = `select not exists (select 1 from public.admin_role_permissions p where p.permission::text = 'data_export') as granted_to_nobody;`;

describe.skipIf(!haveLocalDb())("0262: the permission value, the 55P04 rule, and the two catalog-text checks", () => {
  beforeAll(() => {
    expect(fresh().ok).toBe(true);
  });
  afterAll(() => {
    runSql(`drop type if exists ${PROBE} cascade;`);
  });

  describe("55P04 RED / GREEN", () => {
    it("RED: a cast of the new value in the same transaction fails with 55P04", () => {
      fresh();
      const r = runSql(`begin;\nalter type ${PROBE} add value if not exists 'data_export';\nselect 'data_export'::${PROBE};\ncommit;`);
      expect(r.ok).toBe(false);
      expect(r.stderr).toMatch(/55P04/);
    });

    it("RED: the same for a comparison against the new value", () => {
      fresh();
      const r = runSql(`begin;\nalter type ${PROBE} add value if not exists 'data_export';\nselect 1 where 'blog'::${PROBE} <> 'data_export'::${PROBE};\ncommit;`);
      expect(r.ok).toBe(false);
      expect(r.stderr).toMatch(/55P04/);
    });

    it("GREEN: the shipped file's own text (type name swapped) passes in one transaction", () => {
      fresh();
      const r = runSql(`begin;\n${onProbe(SHIPPED)}\ncommit;\nselect string_agg(enumlabel::text, ',' order by enumsortorder) from pg_enum where enumtypid = '${PROBE}'::regtype;`);
      expect(r.ok, r.stderr).toBe(true);
      expect(last(r.stdout)).toBe("blog,people_list,data_export");
    });
  });

  describe("T-Z2: applies twice, each time inside a transaction", () => {
    it("on the scratch enum: the second run is a no-op, no error, exactly one data_export label", () => {
      fresh();
      for (const run of [1, 2]) {
        const r = runSql(`begin;\n${onProbe(SHIPPED)}\ncommit;`);
        expect(r.ok, `run ${run}: ${r.stderr}`).toBe(true);
      }
      const count = runSql(`select count(*) from pg_enum where enumtypid = '${PROBE}'::regtype and enumlabel::text = 'data_export';`);
      expect(last(count.stdout)).toBe("1");
    });

    it("on the real enum (already migrated): the same two transactions are no-ops and the label is still there exactly once", () => {
      for (const run of [1, 2]) {
        const r = runSql(`begin;\n${SHIPPED}\ncommit;`);
        expect(r.ok, `run ${run}: ${r.stderr}`).toBe(true);
      }
      const count = runSql(`select count(*) from pg_enum where enumtypid = 'public.admin_permission'::regtype and enumlabel::text = 'data_export';`);
      expect(last(count.stdout)).toBe("1");
    });
  });

  describe("T-Z3c: 0262 and 0263 in ONE transaction", () => {
    it("RECORDED RESULT: it applies without error today (0263 never names the value as the enum type); rolled back", () => {
      fresh();
      const r = runSql(`begin;\n${onProbe(SHIPPED)}\n${F0263}\nrollback;`);
      expect(r.ok, r.stderr).toBe(true);
    });

    it("RED: the same transaction with a cast of the value added to 0263 fails with 55P04 (the hazard this test exists to catch before a hosted run)", () => {
      fresh();
      const r = runSql(`begin;\n${onProbe(SHIPPED)}\n${F0263}\nselect 'data_export'::${PROBE};\nrollback;`);
      expect(r.ok).toBe(false);
      expect(r.stderr).toMatch(/55P04/);
    });
  });

  describe("the two catalog-text checks (the exact SQL for the hosted post-check)", () => {
    it("CHECK 1: the label is present on the migrated database", () => {
      const r = runSql(CHECK_LABEL_PRESENT);
      expect(r.ok, r.stderr).toBe(true);
      expect(last(r.stdout)).toBe("t");
    });

    it("CHECK 1 is RED on an enum without the label", () => {
      fresh();
      const r = runSql(CHECK_LABEL_PRESENT.split("public.admin_permission").join(PROBE));
      expect(last(r.stdout)).toBe("f");
    });

    it("CHECK 2: no role holds it on the migrated database (through the API too)", async () => {
      const r = runSql(CHECK_GRANTED_TO_NOBODY);
      expect(r.ok, r.stderr).toBe(true);
      expect(last(r.stdout)).toBe("t");
      const { data, error } = await admin.from("admin_role_permissions").select("role_id, permission");
      expect(error).toBeNull();
      expect((data ?? []).filter((p) => String(p.permission) === "data_export")).toEqual([]);
    });

    it("CHECK 2 is RED when a role is granted it (shown inside a transaction that is rolled back)", () => {
      const r = runSql(
        `begin;\ninsert into public.admin_roles (name) values ('s5-check-probe');\ninsert into public.admin_role_permissions (role_id, permission) select id, 'data_export' from public.admin_roles where name = 's5-check-probe';\n${CHECK_GRANTED_TO_NOBODY}\nrollback;`,
      );
      expect(r.ok, r.stderr).toBe(true);
      expect(r.stdout.trim().split("\n").filter((l) => l === "t" || l === "f")).toEqual(["f"]);
    });

    it("neither check names the value as the enum type", () => {
      for (const sql of [CHECK_LABEL_PRESENT, CHECK_GRANTED_TO_NOBODY]) {
        expect(sql).not.toMatch(/'data_export'\s*::/);
        expect(sql).not.toMatch(/::\s*(public\.)?admin_permission/);
      }
    });
  });
});
