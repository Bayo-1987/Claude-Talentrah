/**
 * Migration 0250 (Talent Directory renewal claim) and its rollback: their SHAPE, read from the files (no database). The behaviour is in tests/talent-directory/renewal-claim.test.ts (CI, a real database).
 * Pins: one nullable column and nothing else, no grant to an API role (the column is service-role bookkeeping), a self-check that proves it, and a rollback that drops only that column.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = join(__dirname, "../../supabase/migrations/0250_td_renewal_claim.sql");
const ROLLBACK = join(__dirname, "../../supabase/rollbacks/0250_td_renewal_claim.rollback.sql");
const strip = (t: string) => t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const raw = existsSync(MIGRATION) ? readFileSync(MIGRATION, "utf8") : "";
const rawRollback = existsSync(ROLLBACK) ? readFileSync(ROLLBACK, "utf8") : "";
const flat = strip(raw).replace(/\s+/g, " ").toLowerCase();
const rollback = strip(rawRollback).replace(/\s+/g, " ").toLowerCase();

describe("0250: the files", () => {
  it("exist under the registered number", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(existsSync(ROLLBACK)).toBe(true);
    expect(raw).not.toMatch(/NNNN/);
  });
  it("adds exactly one nullable timestamptz column to talent_directory_subscriptions and nothing else", () => {
    expect(flat).toContain("alter table public.talent_directory_subscriptions add column if not exists renewal_claimed_at timestamptz;");
    expect(flat.match(/add column/g)).toHaveLength(1);
    expect(flat).not.toMatch(/\bdrop\b|\bcreate (table|function|or replace function|policy|trigger|index|unique index)\b|\bgrant\b|\brevoke\b|\balter column\b/);
    expect(flat).not.toMatch(/renewal_claimed_at timestamptz not null/);
  });
  it("proves the column is nullable, unclaimed everywhere and unreadable and unwritable to the API roles", () => {
    expect(flat).toContain("is_nullable = 'yes'");
    expect(flat).toContain("has_column_privilege('authenticated', 'public.talent_directory_subscriptions', 'renewal_claimed_at', 'select')");
    expect(flat).toContain("has_column_privilege('anon', 'public.talent_directory_subscriptions', 'renewal_claimed_at', 'select')");
    expect(flat).toContain("'update'");
    expect(flat).toContain("renewal_claimed_at is not null");
  });
});

describe("0250: the rollback", () => {
  it("drops only that column, in one transaction", () => {
    expect(rollback).toMatch(/^begin;/);
    expect(rollback).toContain("drop column if exists renewal_claimed_at");
    expect(rollback).toMatch(/commit;\s*$/);
    expect((rollback.match(/\bdrop\b/g) ?? []).length).toBe(1);
    expect(rollback.match(/alter table/g)).toHaveLength(1);
  });
});
