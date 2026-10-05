/**
 * Migration 0222 (message history is written by the server only) and its rollback: their shape, read from the files (no database). The behaviour is in tests/rls/farah-history-shapes.test.ts and
 * tests/rls/farah-history-cascade.test.ts (database-backed, CI); this pins what a reviewer would otherwise have to find by reading the SQL.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const strip = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const flat = (sql: string) => strip(sql).replace(/\s+/g, " ").toLowerCase();

const MIGRATION = "supabase/migrations/0222_farah_tables_server_only_writes.sql";
const ROLLBACK = "supabase/rollbacks/0222_farah_tables_server_only_writes.rollback.sql";
const m = flat(read(MIGRATION)).trim();
const rb = flat(read(ROLLBACK)).trim();

describe("0222: what the migration changes", () => {
  it("revokes INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on both Farah tables from public, anon and authenticated", () => {
    expect(m).toMatch(/revoke insert, update, delete, truncate, references, trigger on table public\.farah_messages from public, anon, authenticated;/);
    expect(m).toMatch(/revoke insert, update, delete, truncate, references, trigger on table public\.farah_session_events from public, anon, authenticated;/);
  });

  it("changes nothing else: no grant, no policy, no row level security change, no create, drop or alter, no SELECT revoke, no revoke all", () => {
    expect(m).not.toMatch(/\bgrant\b/);
    expect(m).not.toMatch(/\bcreate policy\b|\bdrop policy\b|\balter policy\b/);
    expect(m).not.toMatch(/\balter table\b|\bdrop\b|\bcreate (table|function|index|type)\b/);
    expect(m).not.toMatch(/revoke [a-z, ]*\bselect\b/);
    expect(m).not.toMatch(/revoke [a-z, ]*\ball\b/);
  });

  it("touches only the two Farah tables", () => {
    const tables = [...m.matchAll(/(?:revoke [a-z, ]+ on table|has_table_privilege\([^,]+, ')(public\.[a-z_]+)/g)].map((x) => x[1]);
    expect(new Set(tables)).toEqual(new Set(["public.farah_messages", "public.farah_session_events"]));
  });

  it("checks itself when applied: none of the six privileges left for anon, authenticated or PUBLIC, and what must still work (SELECT for the signed-in role, the service role's own privileges)", () => {
    expect(m).toMatch(/do \$check\$/);
    expect(m).toMatch(/foreach p in array array\['insert', 'update', 'delete', 'truncate', 'references', 'trigger'\] loop/);
    expect(m).toMatch(/has_table_privilege\(r, t::regclass, p\)/);
    expect(m).toMatch(/aclexplode/);
    expect(m).toMatch(/a\.grantee = 0 and a\.privilege_type in \('insert', 'update', 'delete', 'truncate', 'references', 'trigger'\)/);
    expect(m).toMatch(/has_table_privilege\('authenticated', 'public\.farah_messages'::regclass, 'select'\)/);
    expect(m).toMatch(/has_table_privilege\('service_role', 'public\.farah_messages'::regclass, p\)/);
  });
});

describe("0222: the rollback restores the before-state, and only that", () => {
  it("runs in one transaction with both timeouts set, and ends by checking the privileges against the before-state it lists", () => {
    expect(rb).toMatch(/^begin; set local lock_timeout = '2s'; set local statement_timeout = '20s';/);
    expect(rb).toMatch(/do \$check\$/);
    expect(rb).toMatch(/v_expected constant text :=/);
    expect(rb).toMatch(/if v_actual <> v_expected then/);
    expect(rb).toMatch(/commit;$/);
  });

  it("records the before-state it was built from as comments, and says plainly if it is provisional", () => {
    const raw = read(ROLLBACK);
    expect(raw).toMatch(/-- BEFORE farah_messages: \{/);
    expect(raw).toMatch(/-- BEFORE farah_session_events: \{/);
    expect(raw).toMatch(/PROVISIONAL|Built from the BEFORE ACLs the dry run printed/);
  });

  it("only grants (back) the six privileges, only to anon, authenticated and public, only on the two Farah tables; no SELECT, no policy, no alter", () => {
    const grants = [...rb.matchAll(/grant ([a-z, ]+) on table (public\.[a-z_]+) to ([a-z]+)( with grant option)?;/g)];
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) {
      for (const p of g[1].split(",").map((x) => x.trim())) expect(["insert", "update", "delete", "truncate", "references", "trigger"]).toContain(p);
      expect(["public.farah_messages", "public.farah_session_events"]).toContain(g[2]);
      expect(["anon", "authenticated", "public"]).toContain(g[3]);
    }
    expect(rb).not.toMatch(/\bpolicy\b|\balter table\b|grant select/);
  });
});
