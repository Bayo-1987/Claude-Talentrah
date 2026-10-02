/**
 * ACCT-1 PR 1 — the rollback file kept beside 0212 (supabase/rollbacks/0212_account_deletion_request.rollback.sql), checked without a database.
 *
 * What it must be: one transaction; every function and policy 0212 rewrote put back to its previous body BEFORE the new objects are dropped (so nothing
 * still refers to the flag or the helper when they go); and every object 0212 created dropped. That 0212 + this file restores the previous definitions
 * exactly is proved against the real catalogue, in a rolled-back transaction, when the PR is opened (output in the PR body); this test keeps the file
 * complete as the migration changes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const migration = read("supabase/migrations/0212_account_deletion_request.sql");
const rollback = read("supabase/rollbacks/0212_account_deletion_request.rollback.sql");
const code = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

const rewritten = [...code(migration).matchAll(/create or replace function public\.([a-z_]+)\(/g)]
  .map((m) => m[1])
  .filter((n) => !n.startsWith("account_"));

describe("0212 rollback", () => {
  it("is one transaction", () => {
    expect(code(rollback).trim().startsWith("begin;")).toBe(true);
    expect(code(rollback).trim().endsWith("commit;")).toBe(true);
  });

  it("restores every function 0212 rewrote (and reset_test_pool_user), once each", () => {
    expect(rewritten.length).toBe(15);
    for (const name of rewritten) {
      const n = code(rollback).match(new RegExp(`create or replace function public\\.${name}\\(`, "g")) ?? [];
      expect(n.length, `${name} must be restored exactly once`).toBe(1);
    }
  });

  it("restores the two mentor policies by their current name, to the expressions they had", () => {
    expect(rollback).toMatch(/alter policy %I on public\.mentor_profiles using \(\(\(\(status = ''approved''\) and \(not self_paused\)\) or/);
    expect(rollback).toMatch(/alter policy %I on public\.mentor_availability_slots using/);
  });

  it("no restored body mentions the flag or the helper any more", () => {
    const beforeDrops = code(rollback).split("drop function if exists public.account_deletion_restore()")[0];
    expect(beforeDrops).not.toMatch(/deletion_requested_at|account_is_active|account_deletions/);
  });

  it("drops every object 0212 created, AFTER the restores", () => {
    const body = code(rollback);
    const firstDrop = body.indexOf("drop function if exists");
    for (const fn of ["account_deletion_restore()", "account_deletion_status()", "account_deletion_confirm(uuid, text)", "account_deletion_create_request(uuid, text)", "account_deletion_blockers(uuid)", "account_is_active(uuid)"]) {
      const at = body.indexOf(`drop function if exists public.${fn}`);
      expect(at, fn).toBeGreaterThan(firstDrop - 1);
      expect(at).toBeGreaterThan(body.lastIndexOf("create or replace function public."));
    }
    expect(body).toMatch(/drop table if exists public\.account_deletions;/);
    expect(body).toMatch(/alter table public\.profiles drop column if exists deletion_requested_at;/);
  });

  it("warns, in its header, that it destroys the request records and what to check first", () => {
    expect(rollback).toMatch(/WHAT IT DESTROYS/);
    expect(rollback).toMatch(/status = 'scheduled'/);
  });
});
