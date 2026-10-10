/**
 * Migration 0247 (payment_transactions: what the Paystack check found, beside the row): its SHAPE, read from the files (no database). The behaviour is in tests/rls/payment-reconcile-columns.test.ts (CI, a real database).
 * This pins what a behavioural test would only notice after somebody was hurt: three additive columns and nothing else (status, its enum and fulfillPayment's "not pending means done" rule are untouched), the result column
 * limited to a closed list of words, no grant to an API role, and a rollback that only drops those three columns.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(__dirname, "../../supabase/migrations/0247_payment_reconcile_columns.sql");
const ROLLBACK = join(__dirname, "../../supabase/rollbacks/0247_payment_reconcile_columns.rollback.sql");
const strip = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = existsSync(MIGRATION) ? readFileSync(MIGRATION, "utf8") : "";
const rawRollback = existsSync(ROLLBACK) ? readFileSync(ROLLBACK, "utf8") : "";
const flat = strip(raw).replace(/\s+/g, " ").toLowerCase();
const rollback = strip(rawRollback).replace(/\s+/g, " ").toLowerCase();

/** The words a check may record. The application's type (src/lib/billing/reconcile.ts) and this list must agree: the app test reads this file. */
export const RESULT_WORDS = [
  "error",
  "fulfilled_by_check",
  "paystack_abandoned",
  "paystack_failed",
  "paystack_not_found",
  "paystack_reversed",
  "paystack_unsettled",
];

describe("0247: the files", () => {
  it("exist under the registered number", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
    expect(raw).not.toMatch(/NNNN/);
  });

  it("is additive: three columns on payment_transactions, no drop, no new table, function, policy, trigger or type", () => {
    expect(flat).not.toMatch(/\bdrop\b/);
    expect(flat).not.toMatch(/\bcreate (table|function|or replace function|policy|trigger|type|index)\b/);
    expect(flat.match(/alter table public\.payment_transactions/g)).toHaveLength(1);
    expect((flat.match(/add column/g) ?? []).length).toBe(3);
    for (const col of ["reconcile_checked_at timestamptz", "reconcile_result text", "reconcile_attempts integer not null default 0"]) {
      expect(flat, col).toContain(`add column if not exists ${col}`);
    }
  });

  it("does not touch status, the payment_status enum or any existing column", () => {
    expect(flat).not.toMatch(/alter column/);
    expect(flat).not.toMatch(/payment_status/);
    expect(flat).not.toMatch(/set status|status =/);
  });

  it("limits the result to the closed list, and the attempts count to zero or more", () => {
    const m = /check \(reconcile_result is null or reconcile_result in \(([^)]*)\)\)/.exec(flat);
    expect(m, "no closed-list check on reconcile_result").not.toBeNull();
    const words = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(words).toEqual([...RESULT_WORDS].sort());
    expect(flat).toMatch(/check \(reconcile_attempts >= 0\)/);
  });

  it("grants nothing to an API role (the application reads these columns with the service role only)", () => {
    expect(flat).not.toMatch(/\bgrant\b/);
    expect(flat).not.toMatch(/\brevoke\b/);
  });

  it("checks itself: the columns exist, and no API role can read or write them", () => {
    expect(flat).toContain("has_column_privilege('authenticated', 'public.payment_transactions', 'reconcile_result', 'select')");
    expect(flat).toContain("has_column_privilege('anon', 'public.payment_transactions', 'reconcile_result', 'select')");
    expect(flat).toContain("has_column_privilege('authenticated', 'public.payment_transactions', 'reconcile_result', 'update')");
  });
});

describe("0247: the rollback", () => {
  it("drops exactly the three columns and nothing else", () => {
    expect((rollback.match(/drop column/g) ?? []).length).toBe(3);
    for (const col of ["reconcile_checked_at", "reconcile_result", "reconcile_attempts"]) {
      expect(rollback, col).toContain(`drop column if exists ${col}`);
    }
    expect(rollback).not.toMatch(/drop (table|function|policy|constraint)/);
    expect(rollback.match(/alter table/g)).toHaveLength(1);
  });

  it("is one transaction", () => {
    expect(rollback).toMatch(/^begin;/);
    expect(rollback).toMatch(/commit;\s*$/);
  });
});
