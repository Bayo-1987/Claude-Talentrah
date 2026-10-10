/**
 * Migration 0252 (a Farah paid-message hold is refunded at most once) and its rollback: their SHAPE, read from the files (no database). The behaviour is in tests/rls/farah-hold-refund-once.test.ts (CI, a real database).
 * This pins what a behavioural test would only notice after somebody was hurt: exactly one index, partial and unique on the hold id, limited to positive rows of the one reason (so no other reason's repeated ids
 * are refused and the hold's own -1 spend row is not in it), no data change, and a rollback that drops only that index.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(__dirname, "../../supabase/migrations/0252_farah_hold_refund_once.sql");
const ROLLBACK = join(__dirname, "../../supabase/rollbacks/0252_farah_hold_refund_once.rollback.sql");
const strip = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = existsSync(MIGRATION) ? readFileSync(MIGRATION, "utf8") : "";
const rawRollback = existsSync(ROLLBACK) ? readFileSync(ROLLBACK, "utf8") : "";
const flat = strip(raw).replace(/\s+/g, " ").toLowerCase();
const rollback = strip(rawRollback).replace(/\s+/g, " ").toLowerCase();

describe("0252: the files", () => {
  it("exist under the registered number", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
    expect(raw).not.toMatch(/NNNN/);
  });

  it("creates exactly one index and changes no data, table, column, function or grant", () => {
    expect(flat.match(/create unique index/g)).toHaveLength(1);
    expect(flat).not.toMatch(/\b(insert|update|delete)\b (into|from)?\s*public\./);
    expect(flat).not.toMatch(/\balter table\b|\bcreate table\b|\bdrop\b|\bcreate (or replace )?function\b|\bgrant\b|\brevoke\b|\bcreate policy\b|\bcreate trigger\b/);
  });

  it("is a PARTIAL unique index on the hold id for positive Farah-message rows only", () => {
    expect(flat).toContain("create unique index if not exists credit_ledger_farah_hold_refund_once_idx on public.credit_ledger (related_entity_id)");
    expect(flat).toContain("where reason = 'farah_chat_message' and delta > 0 and related_entity_id is not null");
  });

  it("refuses to run (with a plain message) when two refunds already share a hold id, and checks the index it built", () => {
    expect(flat).toContain("having count(*) > 1");
    expect(flat).toContain("two refunds already share a farah hold id");
    expect(flat).toContain("pg_get_indexdef");
    expect(flat).toContain("i.indisunique");
  });
});

describe("0252: the rollback", () => {
  it("drops only that index, in one transaction", () => {
    expect(rollback).toMatch(/^begin;/);
    expect(rollback).toContain("drop index if exists public.credit_ledger_farah_hold_refund_once_idx;");
    expect(rollback).toMatch(/commit;\s*$/);
    expect((rollback.match(/\bdrop\b/g) ?? []).length).toBe(1);
    expect(rollback).not.toMatch(/\balter\b|\bdelete\b|\bupdate\b|\btruncate\b/);
  });
});
