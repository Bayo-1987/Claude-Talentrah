/**
 * 0264 adds the `user_messaging` admin permission and NOTHING else (rows 1 to 3 of the red-first list). Copy of the shape of 0262's tests.
 *
 *   row 1  the file is exactly one statement: alter type public.admin_permission add value if not exists 'user_messaging'
 *   row 2  a new enum value cannot be used in the transaction that adds it (55P04): shown on a scratch copy of the enum, with the shipped file's own text (type name swapped) passing in one
 *          transaction; and the file never names the value as the enum type itself
 *   row 3  the rollback removes role grants of the label, compared as TEXT, and leaves the value (an enum value cannot be dropped); it never names the value as the enum type either
 * The static tests need no database. The database tests run on the local stack only, through the guarded wrapper (skipped where there is none, which the guard test refuses to hide).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runN1Sql } from "./migration-0265-local-db";
import { F0264, R0264, ROOT, last, readMigration, readRollback, statements, usesNewValueAsEnum } from "./migration-0265-support";

const LABEL = "user_messaging";
const PROBE = "public.n1_admin_permission_probe";
const onProbe = (sql: string) => sql.split("public.admin_permission").join(PROBE);
const fresh = () => runN1Sql(`drop type if exists ${PROBE} cascade; create type ${PROBE} as enum ('blog', 'people_list');`);

describe("row 1: 0264 is exactly one statement", () => {
  it("the files exist", () => {
    expect(existsSync(join(ROOT, "supabase/migrations", F0264))).toBe(true);
    expect(existsSync(join(ROOT, "supabase/rollbacks", R0264))).toBe(true);
  });

  it("holds one statement, and it is the alter type ... add value if not exists 'user_messaging'", () => {
    expect(statements(readMigration(F0264))).toEqual([`alter type public.admin_permission add value if not exists '${LABEL}'`]);
  });

  it("the statement parser counts a second statement and a do block (so the test above can fail)", () => {
    expect(statements(`alter type public.admin_permission add value if not exists '${LABEL}'; select 1;`)).toHaveLength(2);
    expect(statements(`alter type public.admin_permission add value if not exists '${LABEL}'; do $c$ begin null; end $c$;`)).toHaveLength(2);
    expect(statements(`-- note\nalter type public.admin_permission add value if not exists '${LABEL}';\n-- tail`)).toHaveLength(1);
  });

  it("the file contains none of 0265's objects", () => {
    const c = readMigration(F0264).toLowerCase();
    for (const needle of ["create table", "create function", "create or replace function", "create index", "grant ", "revoke ", "notification", "push_subscriptions", "admin_messages"]) {
      expect(statements(c).join(" "), needle).not.toContain(needle);
    }
  });
});

describe("row 2: the new label is never used as the enum in the transaction that adds it", () => {
  it("static: 0264 itself does not cast, type or compare the label as the enum", () => {
    expect(usesNewValueAsEnum(readMigration(F0264), LABEL)).toBe(false);
  });

  it("the detector catches a cast, a typed literal and a comparison, and lets text reads through (so the test above can fail)", () => {
    for (const bad of [`select '${LABEL}'::public.admin_permission;`, `select cast('${LABEL}' as public.admin_permission);`, `select admin_permission '${LABEL}';`, `select 1 where p.permission = '${LABEL}';`]) {
      expect(usesNewValueAsEnum(bad, LABEL), bad).toBe(true);
    }
    expect(usesNewValueAsEnum(`select 1 where p.permission::text = '${LABEL}';`, LABEL)).toBe(false);
  });

  describe("on the local stack, with a scratch copy of the enum", () => {
    beforeAll(() => {
      expect(fresh().ok).toBe(true);
    });
    afterAll(() => {
      runN1Sql(`drop type if exists ${PROBE} cascade;`);
    });

    it("RED: a cast of the new value in the same transaction fails with 55P04", () => {
      fresh();
      const r = runN1Sql(`begin;\nalter type ${PROBE} add value if not exists '${LABEL}';\nselect '${LABEL}'::${PROBE};\ncommit;`);
      expect(r.ok).toBe(false);
      expect(r.stderr).toMatch(/55P04/);
    });

    it("GREEN: the shipped file's own text (type name swapped) passes in one transaction and adds exactly one label", () => {
      fresh();
      const r = runN1Sql(`begin;\n${onProbe(readMigration(F0264))}\ncommit;\nselect string_agg(enumlabel::text, ',' order by enumsortorder) from pg_enum where enumtypid = '${PROBE}'::regtype;`);
      expect(r.ok, r.stderr).toBe(true);
      expect(last(r.stdout)).toBe(`blog,people_list,${LABEL}`);
    });

    it("applies twice, each in its own transaction: the second run is a no-op (the real enum, already migrated)", () => {
      for (const run of [1, 2]) {
        const r = runN1Sql(`begin;\n${readMigration(F0264)}\ncommit;`);
        expect(r.ok, `run ${run}: ${r.stderr}`).toBe(true);
      }
      const count = runN1Sql(`select count(*) from pg_enum where enumtypid = 'public.admin_permission'::regtype and enumlabel::text = '${LABEL}';`);
      expect(last(count.stdout)).toBe("1");
    });

    it("the label is present on the migrated database and is granted to nobody (read as text; the Data API test holds it briefly in a role named n1-api-*, which is ignored)", () => {
      const present = runN1Sql(`select exists (select 1 from pg_catalog.pg_enum e where e.enumtypid = 'public.admin_permission'::regtype and e.enumlabel::text = '${LABEL}');`);
      expect(last(present.stdout)).toBe("t");
      const nobody = runN1Sql(`select not exists (select 1 from public.admin_role_permissions p join public.admin_roles r on r.id = p.role_id where p.permission::text = '${LABEL}' and r.name not like 'n1-api-%');`);
      expect(last(nobody.stdout)).toBe("t");
    });
  });
});

describe("row 3: the rollback removes grants of the label as text and leaves the value", () => {
  it("static: the rollback never names the label as the enum type", () => {
    expect(usesNewValueAsEnum(readRollback(R0264), LABEL)).toBe(false);
  });

  it("static: the rollback compares the permission as text", () => {
    expect(readRollback(R0264).replace(/--.*$/gm, "")).toMatch(new RegExp(`permission::text\\s*=\\s*'${LABEL}'`));
  });

  describe("on the local stack (everything rolled back)", () => {
    it("removes a grant of the label, keeps other grants, and the label is still there afterwards", () => {
      const r = runN1Sql(
        [
          "begin;",
          "insert into public.admin_roles (name) values ('n1-rollback-probe');",
          `insert into public.admin_role_permissions (role_id, permission) select id, '${LABEL}' from public.admin_roles where name = 'n1-rollback-probe';`,
          "insert into public.admin_role_permissions (role_id, permission) select id, 'blog' from public.admin_roles where name = 'n1-rollback-probe';",
          readRollback(R0264),
          `select 'grants_of_label=' || count(*) from public.admin_role_permissions p join public.admin_roles r on r.id = p.role_id where r.name = 'n1-rollback-probe' and p.permission::text = '${LABEL}';`,
          "select 'other_grants=' || count(*) from public.admin_role_permissions p join public.admin_roles r on r.id = p.role_id where r.name = 'n1-rollback-probe' and p.permission::text = 'blog';",
          `select 'label_present=' || exists (select 1 from pg_enum where enumtypid = 'public.admin_permission'::regtype and enumlabel::text = '${LABEL}');`,
          "rollback;",
        ].join("\n"),
      );
      expect(r.ok, r.stderr).toBe(true);
      const lines = r.stdout.split("\n").map((l) => l.trim());
      expect(lines).toContain("grants_of_label=0");
      expect(lines).toContain("other_grants=1");
      expect(lines).toContain("label_present=true");
    });

    it("is safe to run when nothing holds the label", () => {
      const r = runN1Sql(`begin;\n${readRollback(R0264)}\n${readRollback(R0264)}\nrollback;`);
      expect(r.ok, r.stderr).toBe(true);
    });
  });
});
