/**
 * 0266 (the marks foundation): its rollback is proved by comparing the CATALOG, not by reading the SQL.
 *
 * Static (no database): the resolve_talent_verification the rollback puts back is, token for token, the one 0142 created (the last migration to define it).
 *
 * Database (local stack only, skipped where there is none): in ONE transaction that is always rolled back, on the database where the runner has applied 0266, four snapshots of the whole public schema are taken
 * (functions with a hash of their text, definer flag, config and privileges; columns; constraints; indexes; triggers; policies; relations with their privileges, row security and comment; column privileges; enums):
 *   A  as applied by the runner                      B  after the rollback file                C  after the forward file is run again on B
 *   - C equals A in every line: running the forward file after its rollback gives back the applied state, so the rollback undid exactly what the forward file does.
 *   - A and B differ ONLY in lines about the objects 0266 owns (verification_marks, its five functions, and resolve_talent_verification, which the rollback hands back as it was).
 *   - B holds no trace of verification_marks or of the five new functions, and its resolve_talent_verification text is not the 0266 text.
 * The comparison with the state BEFORE 0266 (a database that never had it) cannot be made inside one database; it was made by hand on two states of one stack and is in the report that came with this file.
 * The transaction takes ACCESS EXCLUSIVE locks on verification_marks for about a second; lock_timeout makes a collision fail loudly instead of waiting.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { haveLocalDb, runSql } from "../support/local-psql";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const FORWARD = read("supabase/migrations/0266_verification_marks.sql");
const ROLLBACK = read("supabase/rollbacks/0266_verification_marks.rollback.sql");
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const resolveFn = (sql: string) => {
  const i = sql.indexOf("create or replace function public.resolve_talent_verification(");
  return norm(sql.slice(i, sql.indexOf("$$;", sql.indexOf("as $$", i)) + 3));
};

describe("the function the rollback restores is the one 0142 created", () => {
  it("token for token (whitespace and case aside)", () => {
    const restored = resolveFn(ROLLBACK);
    expect(restored.length).toBeGreaterThan(800);
    expect(restored).toBe(resolveFn(read("supabase/migrations/0142_talent_directory_human_review.sql")));
    expect(resolveFn(FORWARD)).not.toBe(restored);
  });
  it("no other migration defines it, so 0142 is the one that was in force before 0266", () => {
    const definers = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql") && !f.startsWith("0266") && /function public\.resolve_talent_verification\(/.test(read(`supabase/migrations/${f}`)));
    expect(definers).toEqual(["0135_talent_directory_schema.sql", "0142_talent_directory_human_review.sql"]);
  });
});

/** The snapshot queries: one text line per catalog fact, without ORDER BY (the comparison is by set). */
const QUERIES = [
  "select 'FUNCTIONS|' || p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid)) || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || p.proisstrict::text || '|' || coalesce(p.proconfig::text,'') || '|' || coalesce(p.proacl::text,'') || '|' || p.proowner::regrole::text || '|' || coalesce(obj_description(p.oid,'pg_proc'),'') from pg_proc p where p.pronamespace='public'::regnamespace",
  "select 'COLUMNS|' || table_name || '.' || column_name || '|' || ordinal_position || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default,'') || '|' || coalesce(character_maximum_length::text,'') from information_schema.columns where table_schema='public'",
  "select 'CONSTRAINTS|' || cl.relname || '|' || co.conname || '|' || pg_get_constraintdef(co.oid) from pg_constraint co join pg_class cl on cl.oid=co.conrelid where cl.relnamespace='public'::regnamespace",
  "select 'INDEXES|' || tablename || '|' || indexname || '|' || indexdef from pg_indexes where schemaname='public'",
  "select 'TRIGGERS|' || cl.relname || '|' || pg_get_triggerdef(t.oid) from pg_trigger t join pg_class cl on cl.oid=t.tgrelid where not t.tgisinternal and cl.relnamespace='public'::regnamespace",
  "select 'POLICIES|' || tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,'') from pg_policies where schemaname='public'",
  "select 'RELATIONS|' || cl.relname || '|' || cl.relkind::text || '|' || coalesce(cl.relacl::text,'') || '|' || cl.relrowsecurity::text || '|' || cl.relforcerowsecurity::text || '|' || cl.relowner::regrole::text || '|' || coalesce(obj_description(cl.oid,'pg_class'),'') from pg_class cl where cl.relnamespace='public'::regnamespace and cl.relkind in ('r','p','v','m','f','S')",
  "select 'COLUMNACL|' || cl.relname || '.' || a.attname || '|' || a.attacl::text from pg_attribute a join pg_class cl on cl.oid=a.attrelid where cl.relnamespace='public'::regnamespace and a.attacl is not null and not a.attisdropped",
  "select 'ENUMS|' || t.typname || '|' || string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace group by t.typname",
];
const snap = (label: string) => QUERIES.map((q) => `insert into snap(label, line) select '${label}', t.line from (${q}) t(line);`).join("\n");
const OWNED = "(verification_marks|verification_mark_is_live|resume_content_hash|award_verification_mark|employer_visible_marks|applicant_visible_marks|resolve_talent_verification)";
// a function by name, or anything about the table: NOT a column that happens to be called resume_content_hash (tailoring_result_cache has one)
const TRACE = "^(FUNCTIONS[|](verification_mark_is_live|resume_content_hash|award_verification_mark|employer_visible_marks|applicant_visible_marks)[(]|[A-Z]+[|]verification_marks[.|])";
const body = (sql: string) => sql.split("\n").filter((l) => !/^\s*(begin|commit);\s*$/i.test(l)).join("\n");
const diff = (x: string, y: string) => `select count(*) from (select line from snap where label='${x}' except select line from snap where label='${y}') d`;
const owned = (x: string, y: string) => `select count(*) from (select line from snap where label='${x}' except select line from snap where label='${y}') d where d.line !~ '${OWNED}'`;

describe.skipIf(!haveLocalDb())("the rollback, proved on the catalog (one transaction, always rolled back)", () => {
  const script = [
    "begin;",
    "set local lock_timeout = '20s';",
    "create temp table snap(label text, line text);",
    snap("A"),
    body(ROLLBACK),
    snap("B"),
    body(FORWARD),
    snap("C"),
    `select 'R|a_lines|' || (select count(*) from snap where label='A');`,
    `select 'R|b_lines|' || (select count(*) from snap where label='B');`,
    `select 'R|c_equals_a_missing|' || (${diff("A", "C")});`,
    `select 'R|c_equals_a_extra|' || (${diff("C", "A")});`,
    `select 'R|a_not_b_foreign|' || (${owned("A", "B")});`,
    `select 'R|b_not_a_foreign|' || (${owned("B", "A")});`,
    `select 'R|a_not_b_owned|' || ((${diff("A", "B")}) - (${owned("A", "B")}));`,
    `select 'R|b_traces|' || (select count(*) from snap where label='B' and line ~ '${TRACE}');`,
    `select 'R|b_resolve|' || (select count(*) from snap where label='B' and line like 'FUNCTIONS|resolve_talent_verification(%');`,
    `select 'R|resolve_differs|' || (select count(*) from (select line from snap where label='A' and line like 'FUNCTIONS|resolve_talent_verification(%' except select line from snap where label='B') d);`,
    "rollback;",
  ].join("\n");
  let out: ReturnType<typeof runSql>;
  let res: Record<string, string> = {};
  // run in beforeAll, not while the file is collected: collecting must not need a database (skipIf still runs the describe callback)
  beforeAll(() => {
    out = runSql(script);
    res = Object.fromEntries(out.stdout.split("\n").filter((l) => l.startsWith("R|")).map((l) => l.split("|").slice(1) as [string, string]));
  });

  it("the script runs", () => {
    expect(out.ok, out.stderr).toBe(true);
    expect(Number(res.a_lines)).toBeGreaterThan(1500);
  });
  it("the forward file run again after the rollback gives back exactly the applied state", () => {
    expect([res.c_equals_a_missing, res.c_equals_a_extra]).toEqual(["0", "0"]);
  });
  it("the rollback changes nothing but the objects 0266 owns", () => {
    expect([res.a_not_b_foreign, res.b_not_a_foreign]).toEqual(["0", "0"]);
    expect(Number(res.a_not_b_owned)).toBeGreaterThan(10);
  });
  it("after the rollback there is no trace of the table or the five new functions, and resolve_talent_verification is back to the older text", () => {
    expect(res.b_traces).toBe("0");
    expect(res.b_resolve).toBe("1");
    expect(res.resolve_differs).toBe("1");
  });
});
