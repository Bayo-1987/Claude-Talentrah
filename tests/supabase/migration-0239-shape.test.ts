/**
 * Migration 0239 (anon and authenticated lose TRUNCATE, REFERENCES and TRIGGER on every public table; new tables stop receiving them) and its rollback: their shape, read from the files (no database).
 * The behaviour is in tests/rls/client-ddl-privileges.test.ts (database-backed, CI); the migration also checks itself when applied. This pins what a reviewer would otherwise have to find by reading the SQL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const strip = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const flat = (sql: string) => strip(sql).replace(/\s+/g, " ").toLowerCase();

const MIGRATION = "supabase/migrations/0239_client_ddl_privileges_revoke.sql";
const ROLLBACK = "supabase/rollbacks/0239_client_ddl_privileges_revoke.rollback.sql";
const m = flat(read(MIGRATION));
const rb = flat(read(ROLLBACK));

describe("0239: what the migration changes", () => {
  it("revokes exactly TRUNCATE, REFERENCES and TRIGGER, from public, anon and authenticated, table by table over every ordinary and partitioned table in public", () => {
    expect(m).toMatch(/revoke truncate, references, trigger on table %s from public, anon, authenticated/);
    expect(m).toMatch(/c\.relkind in \('r', 'p'\)/);
    expect(m.match(/execute pg_catalog\.format\('revoke /g)).toHaveLength(1);
  });

  it("revokes nothing else: no SELECT, INSERT, UPDATE or DELETE in any revoke, no revoke all, no grant, no policy, no create, drop or alter table/function", () => {
    for (const stmt of m.match(/revoke [^']*|alter default privileges [^'";]*/g) ?? []) {
      expect(stmt, stmt).not.toMatch(/\b(select|insert|update|delete)\b/);
      expect(stmt, stmt).not.toMatch(/\ball\b/);
    }
    expect(m).not.toMatch(/\bgrant\b/);
    expect(m).not.toMatch(/\bcreate (policy|table|function|index|type|trigger)\b|\bdrop\b|\balter table\b|\balter policy\b/);
  });

  it("changes the default privileges for new tables: the migrating role strictly, any other grantor in pg_default_acl attempted and reported (insufficient_privilege is caught, nothing else is)", () => {
    expect(m).toMatch(/alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;/);
    expect(m).toMatch(/alter default privileges for role %i in schema public revoke truncate, references, trigger on tables from anon, authenticated/);
    expect(m).toMatch(/exception when insufficient_privilege then/);
    expect(m.match(/\bwhen [a-z_]+ then/g)).toEqual(["when insufficient_privilege then"]);
  });

  it("checks itself in one block: no client role holds any of the three (directly, via PUBLIC or by inheritance), PUBLIC holds none, the migrating role's defaults hand none out, and the other privileges are counted before and after", () => {
    expect(m).toMatch(/0239 self-check: a client role still holds a privilege/);
    expect(m).toMatch(/0239 self-check: public itself still holds one of the three/);
    expect(m).toMatch(/0239 self-check: the default privileges of % still give one of the three to a client role/);
    expect(m).toMatch(/0239 self-check: select\/insert\/update\/delete of the client roles changed/);
    expect(m).toMatch(/0239 self-check: the privileges of service_role changed/);
    expect(m).toMatch(/pg_catalog\.has_table_privilege\(r, c\.oid, p\)/);
    expect(m).toMatch(/pg_catalog\.aclexplode\(c\.relacl\)/);
    expect(m.match(/\bdo \$m\$/g)).toHaveLength(1);
  });

  it("does not touch the service role, postgres or any column-level grant by name", () => {
    expect(m).not.toMatch(/revoke [^;]*\b(service_role|postgres)\b/);
    expect(m).not.toMatch(/\(\s*[a-z_]+\s*(,\s*[a-z_]+\s*)*\)\s+on table/); // no column list in a revoke
  });
});

describe("0239: the rollback", () => {
  it("gives back exactly the recorded before-state: two lists of tables (both client roles, and authenticated only), the three privileges, nothing else", () => {
    expect(rb).toMatch(/grant truncate, references, trigger on table public\.%i to anon, authenticated/);
    expect(rb).toMatch(/grant truncate, references, trigger on table public\.%i to authenticated'/);
    expect(rb).not.toMatch(/\bgrant (select|insert|update|delete|all)\b/);
    expect(rb).toMatch(/alter default privileges in schema public grant truncate, references, trigger on tables to anon, authenticated;/);
    const both = /v_both constant text\[\] := array\[([^\]]*)\]/.exec(rb)![1].split(",").map((x) => x.trim().replace(/'/g, ""));
    const auth = /v_auth constant text\[\] := array\[([^\]]*)\]/.exec(rb)![1].split(",").map((x) => x.trim().replace(/'/g, ""));
    expect(both).toHaveLength(46);
    expect(auth).toHaveLength(7);
    expect(both.filter((t) => auth.includes(t))).toEqual([]);
    expect(auth).toEqual(expect.arrayContaining(["talent_verifications", "payment_transactions", "user_passes"]));
  });

  it("refuses when a recorded table is gone, and checks every table in public against the lists when it is done", () => {
    expect(rb).toMatch(/0239 rollback: table public\.% is not there any more/);
    expect(rb).toMatch(/0239 rollback self-check: the privileges are not the recorded before-state/);
  });
});
