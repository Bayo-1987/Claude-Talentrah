/**
 * 0278 (JOBS-POLISH-1, P5, expires_at_source): the shape of the migration and its rollback, read as text (the DB-backed checks are in tests/rls/job-postings-expires-at-source.test.ts, run by S3-21 and CI).
 *
 * What it must be: ONE nullable text column limited to 'stated' / 'default', a SELECT column grant to anon and authenticated (job_postings is readable by explicit column grant, 0218), a server-managed guard
 * trigger (a client cannot carry a value in, 0207's shape), the owner's backfill rule and nothing else: no policy change (0277 owns the INSERT policy), no write grant, no other table.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/0278_job_postings_expires_at_source.sql"), "utf8");
const rollback = readFileSync(path.join(process.cwd(), "supabase/rollbacks/0278_job_postings_expires_at_source.rollback.sql"), "utf8");
/** The statements, without comments. */
const code = (text: string) => text.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("0278_job_postings_expires_at_source.sql", () => {
  const flat = code(sql).replace(/\s+/g, " ");

  it("adds one nullable text column with no default, limited to stated / default by a named check", () => {
    expect(flat).toContain("alter table public.job_postings add column if not exists expires_at_source text;");
    expect(flat).not.toMatch(/expires_at_source text[^;]*(not null|default)/i);
    expect(flat).toContain("check (expires_at_source in ('stated', 'default'))");
    expect(flat).toContain("conname = 'job_postings_expires_at_source_check'");
  });
  it("grants SELECT on that one column to anon and authenticated, and no write privilege to anyone", () => {
    expect(flat).toContain("grant select (expires_at_source) on public.job_postings to anon, authenticated;");
    expect(flat).not.toMatch(/grant (insert|update|all|delete)/i);
  });
  it("keeps clients out of the column with a before insert/update guard that checks the caller (the shape 0207 used)", () => {
    expect(flat).toContain("create or replace function public.job_postings_guard_expires_at_source()");
    expect(flat).toContain("current_user in ('authenticated', 'anon')");
    expect(flat).toContain("raise exception 'expires_at_source is server-managed' using errcode = '42501'");
    expect(flat).toContain("before insert or update on public.job_postings for each row execute function public.job_postings_guard_expires_at_source()");
    expect(flat).toContain("revoke execute on function public.job_postings_guard_expires_at_source() from public, anon, authenticated;");
    expect(flat).toContain("set search_path = ''");
  });
  it("defines the owner's rule once, as a pure service-role-only function: 29 days 23 hours .. 30 days 1 hour after created_at is default, any other dated row is stated, an undated row is null", () => {
    expect(flat).toContain("create or replace function public.expires_at_source_backfill(p_expires_at timestamptz, p_created_at timestamptz) returns text language sql immutable set search_path = ''");
    expect(flat).toContain("when p_expires_at is null then null");
    expect(flat).toContain("when p_expires_at - p_created_at between interval '29 days 23 hours' and interval '30 days 1 hour' then 'default' else 'stated' end;");
    expect(flat).toContain("revoke execute on function public.expires_at_source_backfill(timestamptz, timestamptz) from public, anon, authenticated;");
    expect(flat).toContain("grant execute on function public.expires_at_source_backfill(timestamptz, timestamptz) to service_role;");
  });
  it("resolves each row's source in one more pure service-role-only function: closing_date_source first ('chosen' is stated, 'default' is default), the window rule only where closing_date_source is null", () => {
    expect(flat).toContain("create or replace function public.expires_at_source_resolve(p_closing_date_source text, p_expires_at timestamptz, p_created_at timestamptz) returns text language sql immutable set search_path = ''");
    expect(flat).toContain("select case p_closing_date_source when 'chosen' then 'stated' when 'default' then 'default' else public.expires_at_source_backfill(p_expires_at, p_created_at) end;");
    expect(flat).toContain("revoke execute on function public.expires_at_source_resolve(text, timestamptz, timestamptz) from public, anon, authenticated;");
    expect(flat).toContain("grant execute on function public.expires_at_source_resolve(text, timestamptz, timestamptz) to service_role;");
  });
  it("backfills with that function, only dated rows with no source yet, so a second run changes nothing", () => {
    expect(flat).toContain("update public.job_postings set expires_at_source = public.expires_at_source_resolve(closing_date_source, expires_at, created_at) where expires_at is not null and expires_at_source is null;");
  });
  it("touches no policy, no other table, and writes nothing else", () => {
    expect(flat).not.toMatch(/create (or replace )?policy|alter policy|drop policy/i);
    expect(flat).not.toMatch(/create table|alter table (?!public\.job_postings)/i);
    expect(flat).not.toMatch(/\b(insert into|delete from|truncate)\b/i);
    expect(flat).not.toMatch(/update public\.(?!job_postings )/i);
    expect(flat).not.toMatch(/grant execute[^;]* to [^;]*(anon|authenticated|public)/i);
  });
  it("checks its own result: type, check, both read grants, no UPDATE for clients, the trigger, and no dated row left without a source", () => {
    expect(flat).toContain("has_column_privilege('anon', 'public.job_postings', 'expires_at_source', 'SELECT')");
    expect(flat).toContain("has_column_privilege('authenticated', 'public.job_postings', 'expires_at_source', 'SELECT')");
    expect(flat).toContain("has_column_privilege('anon', 'public.job_postings', 'expires_at_source', 'UPDATE')");
    expect(flat).toContain("has_column_privilege('authenticated', 'public.job_postings', 'expires_at_source', 'UPDATE')");
    expect(flat).toContain("tgname = 'job_postings_guard_expires_at_source'");
    expect(flat).toContain("where expires_at is not null and expires_at_source is null");
    expect(flat).toContain("raise exception");
  });
  it("fails fast on a lock instead of queueing, and has no transaction control (the runner wraps it)", () => {
    expect(flat).toContain("set local lock_timeout = '3s';");
    expect(flat).not.toMatch(/\b(begin|commit|rollback);/i);
  });
});

describe("0278_job_postings_expires_at_source.rollback.sql", () => {
  it("drops the trigger, the function and the column, idempotently, and touches nothing else", () => {
    const flat = code(rollback).replace(/\s+/g, " ");
    expect(flat).toContain("drop trigger if exists job_postings_guard_expires_at_source on public.job_postings;");
    expect(flat).toContain("drop function if exists public.job_postings_guard_expires_at_source();");
    expect(flat).toContain("drop function if exists public.expires_at_source_resolve(text, timestamptz, timestamptz);");
    expect(flat).toContain("drop function if exists public.expires_at_source_backfill(timestamptz, timestamptz);");
    expect(flat).toContain("alter table public.job_postings drop column if exists expires_at_source;");
    expect(flat).not.toMatch(/drop table|delete from|update public|truncate/i);
  });
});
