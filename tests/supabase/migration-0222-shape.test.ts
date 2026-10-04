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
  it("revokes INSERT, UPDATE and DELETE on both Farah tables from public, anon and authenticated", () => {
    expect(m).toMatch(/revoke insert, update, delete on table public\.farah_messages from public, anon, authenticated;/);
    expect(m).toMatch(/revoke insert, update, delete on table public\.farah_session_events from public, anon, authenticated;/);
  });

  it("changes nothing else: no grant, no policy, no row level security change, no create, drop or alter, no SELECT revoke", () => {
    expect(m).not.toMatch(/\bgrant\b/);
    expect(m).not.toMatch(/\bcreate policy\b|\bdrop policy\b|\balter policy\b/);
    expect(m).not.toMatch(/\balter table\b|\bdrop\b|\bcreate (table|function|index|type)\b/);
    expect(m).not.toMatch(/revoke [a-z, ]*\bselect\b/);
    expect(m).not.toMatch(/revoke [a-z, ]*\b(truncate|references|trigger|all)\b/);
  });

  it("touches only the two Farah tables", () => {
    const tables = [...m.matchAll(/(?:revoke [a-z, ]+ on table|has_table_privilege\([^,]+, ')(public\.[a-z_]+)/g)].map((x) => x[1]);
    expect(new Set(tables)).toEqual(new Set(["public.farah_messages", "public.farah_session_events"]));
  });

  it("checks itself when applied: no write privilege left for anon, authenticated or PUBLIC, and what must still work (SELECT for the signed-in role, the service role's own privileges)", () => {
    expect(m).toMatch(/do \$check\$/);
    expect(m).toMatch(/has_table_privilege\(r, t::regclass, p\)/);
    expect(m).toMatch(/aclexplode/);
    expect(m).toMatch(/a\.grantee = 0 and a\.privilege_type in \('insert', 'update', 'delete'\)/);
    expect(m).toMatch(/has_table_privilege\('authenticated', 'public\.farah_messages'::regclass, 'select'\)/);
    expect(m).toMatch(/has_table_privilege\('service_role', 'public\.farah_messages'::regclass, p\)/);
  });
});

describe("0222: the rollback is the exact undo, and only that", () => {
  it("grants INSERT and DELETE on farah_messages back to authenticated, in one transaction, and checks it", () => {
    expect(rb).toMatch(/^begin; grant insert, delete on table public\.farah_messages to authenticated;/);
    expect(rb).toMatch(/has_table_privilege\('authenticated', 'public\.farah_messages'::regclass, 'insert'\)/);
    expect(rb).toMatch(/commit;$/);
  });

  it("restores nothing for anon, nothing on farah_session_events, and changes no policy", () => {
    expect(rb).not.toMatch(/\banon\b.*\bgrant\b|grant [a-z, ]+ to [a-z, ]*\banon\b/);
    expect(rb.replace(/'public\.farah_session_events'/g, "")).not.toMatch(/farah_session_events/);
    expect(rb).not.toMatch(/\bpolicy\b|\balter table\b/);
  });
});
