/**
 * send-512 / PR 0 — the shape of migration 0209, so two easy-to-miss rules cannot regress.
 *
 *   1. The new enum value is not USED in the migration that adds it. `ALTER TYPE ... ADD VALUE` is legal inside a transaction but the new
 *      label cannot be used in that same transaction ("unsafe use of new value of enum type", see 0049's header). Supabase applies a migration as one
 *      transaction and the production dry run is a single rolled-back transaction, so a default, CHECK, backfill or function body referencing
 *      `needs_refund` here would fail. If anything ever needs it, it goes in a LATER migration.
 *   2. The mentee's notes are nulled by the existing BEFORE UPDATE trigger function, not by a manual step: a foreign key's SET NULL action sets
 *      only the FK column, so the only way to clear `mentee_notes` in the same statement is a trigger that fires on that UPDATE. (The real-delete
 *      test in tests/rls/money-survives-user-deletion.test.ts is the proof that the FK's UPDATE does fire it; a manual UPDATE alone would not be.)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/0209_money_tables_survive_user_deletion.sql", "utf8");
const code = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

describe("0209", () => {
  it("mentions needs_refund in code exactly once: the ADD VALUE statement", () => {
    const uses = code.match(/needs_refund/g) ?? [];
    expect(uses).toHaveLength(1);
    expect(code).toMatch(/alter type public\.payment_status add value if not exists 'needs_refund';/);
  });

  it("the ADD VALUE is the first statement, before anything that could touch payment_status rows", () => {
    const statements = code.split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements[0]).toMatch(/^alter type public\.payment_status add value/);
  });

  it("no default, CHECK or index in 0209 refers to payment_status values", () => {
    expect(code).not.toMatch(/payment_transactions[^;]*(check|default)[^;]*status/i);
  });

  it("clears mentee_notes inside the notes-ownership trigger function, in the same UPDATE that detaches the mentee", () => {
    expect(code).toMatch(/create or replace function public\.enforce_mentorship_session_notes_ownership\(\)/);
    expect(code).toMatch(/old\.mentee_id is not null and new\.mentee_id is null/);
    expect(code).toMatch(/new\.mentee_notes := null/);
  });

  it("replaces all nine foreign keys with ON DELETE SET NULL and drops NOT NULL on the eight columns that had it", () => {
    expect((code.match(/on delete set null/gi) ?? []).length).toBe(9);
    expect((code.match(/alter column \w+ drop not null/gi) ?? []).length).toBe(8); // referrals.referred_user_id was already nullable
    expect(code).not.toMatch(/on delete cascade/i);
  });
});

describe("0209's catalog read", () => {
  it("returns unqualified names for public tables (a bare regclass cast under search_path '' would print public.profiles)", () => {
    expect(code).not.toMatch(/c\.conrelid::regclass::text/);
    expect(code).not.toMatch(/c\.confrelid::regclass::text/);
    expect(code).toMatch(/case when pn\.nspname = 'public' then pc\.relname::text/);
  });
});
