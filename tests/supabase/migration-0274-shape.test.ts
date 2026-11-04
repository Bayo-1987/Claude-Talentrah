/**
 * 0274 (PR-E1, apply by email): the shape of the migration and its rollback, read as text (the DB-backed grant checks run in CI only).
 *
 * What it must be: ONE additive nullable column with a 254-character check and a SELECT column grant to anon and authenticated (job_postings is readable by
 * explicit column grant, 0218), a self-check, and NOTHING else: no write grant, no default, no backfill, no policy or function change. The rollback drops the column.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/0274_job_postings_apply_email.sql"), "utf8");
const rollback = readFileSync(path.join(process.cwd(), "supabase/rollbacks/0274_job_postings_apply_email.rollback.sql"), "utf8");
/** The statements, without comments. */
const code = (text: string) => text.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("0274_job_postings_apply_email.sql", () => {
  const body = code(sql);
  const flat = body.replace(/\s+/g, " ");

  it("adds one nullable text column, with no default and a length check of 254", () => {
    expect(flat).toContain("alter table public.job_postings add column if not exists apply_email text constraint job_postings_apply_email_length check (char_length(apply_email) <= 254);");
    expect(flat).not.toMatch(/apply_email text[^;]*(not null|default)/i);
  });
  it("grants SELECT on that one column to anon and authenticated (without it the first read fails with 42501)", () => {
    expect(flat).toContain("grant select (apply_email) on public.job_postings to anon, authenticated;");
  });
  it("adds no write privilege, no policy, no function, no backfill", () => {
    expect(flat).not.toMatch(/grant (insert|update|all|delete)/i);
    expect(flat).not.toMatch(/create (or replace )?(policy|function|trigger|table|index)/i);
    expect(flat).not.toMatch(/\b(insert into|update public|delete from|drop )/i);
    expect(flat).not.toMatch(/alter policy|alter table [^;]* alter column/i);
  });
  it("checks its own result: the type, the length check, both read grants, and that no client can UPDATE", () => {
    expect(flat).toContain("has_column_privilege('anon', 'public.job_postings', 'apply_email', 'SELECT')");
    expect(flat).toContain("has_column_privilege('authenticated', 'public.job_postings', 'apply_email', 'SELECT')");
    expect(flat).toContain("has_column_privilege('anon', 'public.job_postings', 'apply_email', 'UPDATE')");
    expect(flat).toContain("has_column_privilege('authenticated', 'public.job_postings', 'apply_email', 'UPDATE')");
    expect(flat).toContain("conname = 'job_postings_apply_email_length'");
    expect(flat).toContain("raise exception");
  });
  it("fails fast on a lock instead of queueing behind a long query, and has no transaction control (the runner wraps it)", () => {
    expect(flat).toContain("set local lock_timeout = '3s';");
    expect(flat).not.toMatch(/\b(begin|commit|rollback);/i);
  });
  it("the length in the check is the length the helper enforces", async () => {
    const { APPLY_EMAIL_MAX_LENGTH } = await import("@/lib/jobs/apply-email");
    expect(APPLY_EMAIL_MAX_LENGTH).toBe(254);
  });
});

describe("0274_job_postings_apply_email.rollback.sql", () => {
  it("drops the column, idempotently, and touches nothing else", () => {
    const flat = code(rollback).replace(/\s+/g, " ");
    expect(flat).toContain("alter table public.job_postings drop column if exists apply_email;");
    expect(flat).not.toMatch(/drop table|delete from|update public|truncate/i);
  });
});
