/**
 * 0267 round trip, against the real catalogue: take a snapshot of the public schema's catalogue (every function with its definition, SECURITY DEFINER flag, settings, ACL and comment; and one fingerprint each for
 * columns, relations with their ACLs and row-security flag, column ACLs, policies, triggers, indexes, views and enum labels), run the rollback file, snapshot again, apply the migration file again, snapshot a third time.
 * All of it in ONE transaction that always ends in a rollback, so the database is the same afterwards.
 *
 *   - the rolled-back catalogue is the migrated one MINUS the one function: every other line, including the six existing talent-verification functions, is identical;
 *   - applying the migration again restores the migrated catalogue exactly, line for line (the function's own definition, ACL and comment included);
 *   - a run that leaves the database as it found it: a snapshot taken in a separate session afterwards equals the one before.
 *
 * CI only (it needs a Postgres container on this machine, no password, no URL, no hosted project: tests/support/local-psql.ts refuses any container that is not the stack NEXT_PUBLIC_SUPABASE_URL points at).
 * WITH CI=true anything that stops the run FAILS the test, because a round trip that quietly did not run looks exactly like one that passed. The starting state must already carry 0267, or the run proves nothing.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSql } from "../support/local-psql";

const ROOT = join(__dirname, "../..");
const MIGRATION = "supabase/migrations/0267_verification_claim_timeout.sql";
const ROLLBACK = "supabase/rollbacks/0267_verification_claim_timeout.rollback.sql";
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const FN = "release_stale_verification_claims(";
const EXISTING_SIX = ["claim_talent_verification_review(", "release_talent_verification_review_claim(", "resolve_talent_verification(", "talent_verification_review_queue(", "talent_verification_review_detail(", "talent_verification_my_claims("];

const ns = "n.nspname = 'public'";
const fp = (label: string, name: string, body: string, from: string) => `select 'C|${label}|${name}|' || md5(coalesce(string_agg(${body}, ',' order by ${body}), '')) from ${from};`;

function snapshot(label: string): string {
  return [
    `select 'F|${label}|' || p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid)) || '|' || p.prosecdef || '|' || coalesce(p.proconfig::text, '') || '|' || coalesce(p.proacl::text, '') || '|' || md5(coalesce(obj_description(p.oid, 'pg_proc'), ''))`,
    `from pg_proc p join pg_namespace n on n.oid = p.pronamespace where ${ns} and p.prokind = 'f' order by p.oid::regprocedure::text;`,
    fp(label, "columns", "format('%s.%s.%s.%s.%s.%s', table_name, column_name, udt_name, is_nullable, coalesce(column_default, ''), ordinal_position)", "information_schema.columns where table_schema = 'public'"),
    fp(label, "relations", "format('%s:%s:%s:%s', c.relname, c.relkind, c.relrowsecurity, coalesce(c.relacl::text, ''))", "pg_class c join pg_namespace n on n.oid = c.relnamespace where " + ns),
    fp(label, "column-acls", "format('%s.%s:%s', c.relname, a.attname, a.attacl::text)", "pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace where " + ns + " and a.attacl is not null"),
    fp(label, "policies", "format('%s.%s:%s:%s:%s:%s', tablename, policyname, cmd, roles::text, coalesce(qual, ''), coalesce(with_check, ''))", "pg_policies where schemaname = 'public'"),
    fp(label, "triggers", "format('%s:%s', t.tgname, pg_get_triggerdef(t.oid))", "pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where " + ns + " and not t.tgisinternal"),
    fp(label, "indexes", "indexdef", "pg_indexes where schemaname = 'public'"),
    fp(label, "views", "format('%s:%s', viewname, definition)", "pg_views where schemaname = 'public'"),
    fp(label, "enums", "format('%s:%s', t.typname, e.enumlabel)", "pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace where " + ns),
  ].join("\n");
}

function script(): string {
  return ["set lock_timeout = '5s';", "begin;", snapshot("post"), read(ROLLBACK), snapshot("rolledback"), read(MIGRATION), snapshot("postagain"), "rollback;"].join("\n");
}

function lines(output: string, label: string): string[] {
  return output.split("\n").filter((l) => l.startsWith(`F|${label}|`) || l.startsWith(`C|${label}|`)).map((l) => l.replace(`|${label}|`, "|"));
}

function run(sql: string): string {
  const res = runSql(sql);
  if (!res.ok) throw new Error(`the round-trip script failed:\n${res.stderr}\n${res.stdout}`);
  return res.stdout;
}

describe.skipIf(process.env.CI !== "true")("0267: rollback and re-apply on the local stack (CI only)", () => {
  it("the files it runs are the ones on disk", () => {
    expect(MIGRATION.split("/").pop()!.slice(0, 4)).toBe("0267");
    expect(ROLLBACK.split("/").pop()!.slice(0, 4)).toBe("0267");
    expect(read(MIGRATION)).toContain("create or replace function public.release_stale_verification_claims");
    expect(read(ROLLBACK)).toContain("drop function public.release_stale_verification_claims(timestamptz, interval)");
  });

  it("the starting state carries the function (or the round trip proves nothing)", () => {
    const post = lines(run(script()), "post");
    expect(post.filter((l) => l.includes(FN)), "start from a database that has 0267 applied").toHaveLength(1);
  }, 180_000);

  it("after the rollback the catalogue is the migrated one minus exactly that function", () => {
    const out = run(script());
    const post = lines(out, "post");
    const rolledBack = lines(out, "rolledback");
    expect(post.length).toBeGreaterThan(100);
    expect(rolledBack.filter((l) => l.includes(FN))).toEqual([]);
    expect(rolledBack).toEqual(post.filter((l) => !l.includes(FN)));
    expect(post.filter((l) => !rolledBack.includes(l))).toHaveLength(1);
  }, 180_000);

  it("the six existing talent-verification functions are identical before the rollback, after it and after the re-apply", () => {
    const out = run(script());
    const pick = (label: string) => lines(out, label).filter((l) => EXISTING_SIX.some((n) => l.includes(`|${n}`) || l.includes(`|public.${n}`)));
    const post = pick("post");
    expect(post).toHaveLength(EXISTING_SIX.length);
    expect(pick("rolledback")).toEqual(post);
    expect(pick("postagain")).toEqual(post);
  }, 180_000);

  it("applying the migration again restores the migrated catalogue exactly", () => {
    const out = run(script());
    expect(lines(out, "postagain")).toEqual(lines(out, "post"));
  }, 180_000);

  it("leaves nothing behind: a snapshot in a separate session after the run equals the one before", () => {
    const before = lines(run(["begin;", snapshot("post"), "rollback;"].join("\n")), "post");
    run(script());
    const after = lines(run(["begin;", snapshot("post"), "rollback;"].join("\n")), "post");
    expect(after).toEqual(before);
  }, 180_000);
});
