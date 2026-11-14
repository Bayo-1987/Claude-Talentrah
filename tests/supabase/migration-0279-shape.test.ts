/**
 * 0279 (JOBS-LIFECYCLE-1, stage 1): the shape of the migration and its rollback, read as text (the database-backed checks are tests/rls/job-posting-lifecycle-delete.test.ts and the catalog-driven harness
 * tests/sql/job-posting-lifecycle-delete.harness.sql).
 *
 * What it must be: ADDITIVE (two service-role-only tables, one delete function, one report function, two feature flags that ship OFF) and NOTHING destructive; the delete function is ONE statement that
 * deletes the row and writes its tombstone together, guarded by a NOT EXISTS over EVERY table that references job_postings, and callable by the service role only.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { JOB_POSTING_BLOCKING as BLOCKING, JOB_POSTING_EXEMPT_TABLES as EXEMPT, JOB_POSTING_REFERENCES as REFERENCES } from "../support/job-posting-references";

const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/0279_job_posting_lifecycle.sql"), "utf8");
const rollback = readFileSync(path.join(process.cwd(), "supabase/rollbacks/0279_job_posting_lifecycle.rollback.sql"), "utf8");
const code = (text: string) => text.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const flat = (text: string) => code(text).replace(/\s+/g, " ").trim();

/** The body of the delete function, between its dollar quotes. */
const deleteBody = () => {
  const m = /create or replace function public\.job_posting_delete_unreferenced\([^)]*\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i.exec(sql);
  expect(m, "the delete function is in the migration").not.toBeNull();
  return m![1];
};

describe("0279_job_posting_lifecycle.sql: the tables", () => {
  const f = flat(sql);
  for (const table of ["job_posting_tombstones", "job_posting_lifecycle_runs"]) {
    it(`${table}: created, row security ON with NO policy, closed to public, anon and authenticated, open to the service role`, () => {
      expect(f).toContain(`create table public.${table} (`);
      expect(f).toContain(`alter table public.${table} enable row level security;`);
      expect(f).toContain(`revoke all on public.${table} from public, anon, authenticated;`);
      expect(f).toContain(`grant all on public.${table} to service_role;`);
      expect(f).not.toMatch(new RegExp(`create policy[^;]* on public\\.${table}`));
    });
  }
  it("the tombstone carries what a re-import and an undo need: id, fingerprint, source, title, company, closed_at, deleted_at and the whole row", () => {
    const t = /create table public\.job_posting_tombstones \(([\s\S]*?)\n\);/.exec(sql)![1];
    for (const c of ["job_id uuid primary key", "dedup_fingerprint", "external_source", "title", "company_name", "closed_at", "deleted_at", "row_snapshot jsonb not null"]) expect(t, c).toContain(c);
    expect(f).toContain("create index job_posting_tombstones_fingerprint_idx on public.job_posting_tombstones (dedup_fingerprint)");
  });
  it("the tombstone does NOT reference job_postings (it has to outlive the row it describes)", () => {
    const t = /create table public\.job_posting_tombstones \(([\s\S]*?)\n\);/.exec(sql)![1];
    expect(t).not.toMatch(/references\s+public\.job_postings/i);
  });
});

describe("0279_job_posting_lifecycle.sql: the delete function", () => {
  it("is one SQL statement: delete and tombstone are two data-modifying CTEs of ONE query, not two statements", () => {
    const body = deleteBody();
    const statements = body.split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements, "exactly one statement in the body").toHaveLength(1);
    const f = body.replace(/\s+/g, " ");
    expect(f).toMatch(/with \w+ as \( ?select[\s\S]+\), \w+ as \( ?delete from public\.job_postings[\s\S]+returning[\s\S]+\), \w+ as \( ?insert into public\.job_posting_tombstones[\s\S]+\) select/i);
    expect(code(sql).match(/create or replace function public\.job_posting_delete_unreferenced/gi)).toHaveLength(1);
  });
  it("is SQL, SECURITY DEFINER, with an empty search_path, and locks the rows it is about to delete", () => {
    const head = flat(sql);
    expect(head).toMatch(/create or replace function public\.job_posting_delete_unreferenced\(p_ids uuid\[\], p_closed_before timestamptz, p_run_id uuid default null\) returns table \(deleted_job_id uuid, deleted_banner_path text\) language sql security definer set search_path = ''/);
    expect(deleteBody().replace(/\s+/g, " ")).toContain("for update of j");
  });
  it("only ever deletes a CLOSED row with a closed_at older than the caller's cutoff (the rule of today's nightly delete, kept)", () => {
    const f = deleteBody().replace(/\s+/g, " ");
    expect(f).toContain("j.status = 'closed'::public.job_status");
    expect(f).toContain("j.closed_at is not null");
    expect(f).toContain("j.closed_at < p_closed_before");
    expect(f).toContain("j.id = any (p_ids)");
  });
  it("checks every BLOCKING reference (15): one NOT EXISTS each, in the form the database report looks for", () => {
    const f = deleteBody().replace(/\s+/g, " ");
    expect(BLOCKING).toHaveLength(15);
    for (const [table, column] of BLOCKING) expect(f, `${table}.${column}`).toContain(`not exists (select 1 from public.${table} r where r.${column} = j.id)`);
    expect(f.match(/not exists \(select 1 from public\./g), "no more, no fewer than the blocking list").toHaveLength(BLOCKING.length);
  });
  it("does NOT check the five exempt tables (their rows go with the job): a job whose only references are these is deleted", () => {
    const f = deleteBody().replace(/\s+/g, " ");
    expect(EXEMPT).toHaveLength(5);
    expect(REFERENCES.length).toBe(BLOCKING.length + EXEMPT.length);
    for (const table of EXEMPT) expect(f, table).not.toContain(`public.${table} `);
  });
  it("writes the tombstone from the deleted row itself (so the snapshot is exactly what was deleted) and returns the banner path for the caller", () => {
    const f = deleteBody().replace(/\s+/g, " ");
    expect(f).toContain("to_jsonb(d)");
    expect(f).toMatch(/select d\.id, d\.banner_path from \w+ d/);
  });
  it("EXECUTE: revoked from public, anon and authenticated, granted to the service role only", () => {
    const f = flat(sql);
    expect(f).toContain("revoke all on function public.job_posting_delete_unreferenced(uuid[], timestamptz, uuid) from public, anon, authenticated;");
    expect(f).toContain("grant execute on function public.job_posting_delete_unreferenced(uuid[], timestamptz, uuid) to service_role;");
    expect(f).not.toMatch(/grant execute[^;]* to [^;]*(anon|authenticated|public)/i);
  });
});

describe("0279_job_posting_lifecycle.sql: the report that keeps the list honest", () => {
  const f = flat(sql);
  it("job_posting_reference_report() reads the catalog for every foreign key into job_postings and says whether the delete function checks it, and whether it is EXEMPT", () => {
    expect(f).toContain("create or replace function public.job_posting_reference_report()");
    expect(f).toContain("c.confrelid = 'public.job_postings'::regclass");
    expect(f).toContain("returns table (referencing_table text, referencing_column text, on_delete text, checked boolean, exempt boolean)");
    expect(f).toContain("pg_catalog.pg_get_functiondef('public.job_posting_delete_unreferenced(uuid[], timestamptz, uuid)'::regprocedure)");
    expect(f).toContain("not exists (select 1 from public.' || ");
  });
  it("is closed to every role but the service role, like the delete function", () => {
    expect(f).toContain("revoke all on function public.job_posting_reference_report() from public, anon, authenticated;");
    expect(f).toContain("grant execute on function public.job_posting_reference_report() to service_role;");
  });
  it("the exempt list is an explicit constant inside the report, the five names the Reviewer ruled", () => {
    expect(f).toContain(`cl.relname::text = any (array[${EXEMPT.map((t) => `'${t}'`).join(", ")}])`);
  });
  it("the migration refuses to apply unless every foreign key is checked OR exempt, and none is both (a future table forces a decision)", () => {
    expect(f).toContain("from public.job_posting_reference_report() where not checked and not exempt;");
    expect(f).toContain("from public.job_posting_reference_report() where checked and exempt;");
    expect(f).toContain("raise exception");
  });
});

describe("0279_job_posting_lifecycle.sql: the flags and the rest", () => {
  const f = flat(sql);
  it("two feature_flags rows, both OFF, added without disturbing an existing row", () => {
    expect(f).toContain("insert into public.feature_flags (key, label, enabled) values ('job_lifecycle_close_imports',");
    expect(f).toContain("('job_lifecycle_delete_unreferenced',");
    expect(f).toMatch(/'job_lifecycle_close_imports', '[^']+', false\)/);
    expect(f).toMatch(/'job_lifecycle_delete_unreferenced', '[^']+', false\)/);
    expect(f).toContain("on conflict (key) do nothing;");
    expect(f).not.toMatch(/'(job_lifecycle_[a-z_]+)', '[^']+', true/);
  });
  it("is additive: nothing is dropped, truncated or deleted outside the new function, and no existing table, policy or function is altered", () => {
    const outside = f.replace(/create or replace function public\.job_posting_delete_unreferenced[\s\S]*?\$\$;/i, "");
    expect(outside).not.toMatch(/\bdrop (table|column|function|policy|trigger|index|type)\b/i);
    expect(outside).not.toMatch(/\btruncate\b/i);
    expect(outside).not.toMatch(/\bdelete from\b/i);
    expect(f).not.toMatch(/alter table public\.(?!job_posting_tombstones|job_posting_lifecycle_runs)/i);
    expect(f).not.toMatch(/\b(create|alter|drop) policy\b/i);
    expect(f).not.toMatch(/update public\.job_postings/i);
  });
  it("fails fast on a lock instead of queueing, and has no transaction control (the runner wraps it)", () => {
    expect(f).toContain("set local lock_timeout = '3s';");
    expect(f).not.toMatch(/\b(begin|commit|rollback);/i);
  });
});

describe("0279_job_posting_lifecycle.rollback.sql", () => {
  it("removes exactly what 0279 added, idempotently: both functions, both tables, the two flag rows, and says it is safe only before the first deletion", () => {
    const f = flat(rollback);
    expect(rollback).toContain("SAFE ONLY BEFORE THE FIRST DELETION; afterwards it drops the tombstones (the undo data).");
    expect(f).toContain("drop function if exists public.job_posting_reference_report();");
    expect(f).toContain("drop function if exists public.job_posting_delete_unreferenced(uuid[], timestamptz, uuid);");
    expect(f).toContain("drop table if exists public.job_posting_tombstones;");
    expect(f).toContain("drop table if exists public.job_posting_lifecycle_runs;");
    expect(f).toContain("delete from public.feature_flags where key in ('job_lifecycle_close_imports', 'job_lifecycle_delete_unreferenced');");
    expect(f).not.toMatch(/job_postings\b(?!_)/);
  });
});
