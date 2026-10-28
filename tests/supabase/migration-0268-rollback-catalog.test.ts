/**
 * 0268 (the Promoted strip): its rollback is proved by comparing the CATALOG, not by reading the SQL. CI only, like the 0232 and 0267 round trips: it needs the local stack's Postgres (a container this machine started;
 * tests/support/local-psql.ts refuses any container that is not the stack NEXT_PUBLIC_SUPABASE_URL points at). Everything runs in ONE transaction that always ends in a rollback.
 *
 * The starting state is the database as the runner left it with 0268 applied. Four facts are taken from it:
 *   A  the whole public catalogue as applied      B  the catalogue after the rollback file      C  the catalogue after the forward file is run again on B
 *   REF  a copy of the 0234 search (the definition the rollback is meant to restore), created in the same transaction under another name from the text of the 0234 file itself
 * and asserted:
 *   - C equals A in every line (the forward file after its rollback gives back the applied state);
 *   - A and B differ ONLY in lines about the two objects 0268 owns (the search and the strip helper); nothing else in public changed, privileges included;
 *   - after the rollback there is no trace of the helper, and the search is, in every attribute that matters (text, argument list, result columns, SECURITY DEFINER, volatility, settings, privileges, comment), the 0234 definition.
 * WITH CI=true anything that stops the run FAILS the test: a round trip that quietly did not run looks exactly like one that passed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runSql } from "../support/local-psql";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const FORWARD = read("supabase/migrations/0268_talent_directory_promoted_strip.sql");
const ROLLBACK = read("supabase/rollbacks/0268_talent_directory_promoted_strip.rollback.sql");
const M0234 = read("supabase/migrations/0234_review_date_and_type_on_applicants_and_search.sql");
const body = (sql: string) => sql.split("\n").filter((l) => !/^\s*(begin|commit);\s*$/i.test(l)).join("\n");

/** The 0234 statements about the search (create, revoke, grant, comment), under another name. */
function reference0234(): string {
  const from = M0234.indexOf("create or replace function public.talent_directory_search(");
  const tail = M0234.slice(from);
  const commentAt = tail.indexOf("comment on function public.talent_directory_search(");
  const end = tail.indexOf(";", commentAt) + 1;
  return tail.slice(0, end).replaceAll("talent_directory_search", "zz_ref_talent_directory_search");
}

const QUERIES = [
  "select 'FUNCTIONS|' || p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid)) || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(p.proconfig::text,'') || '|' || coalesce(p.proacl::text,'') || '|' || p.proowner::regrole::text || '|' || coalesce(obj_description(p.oid,'pg_proc'),'') from pg_proc p where p.pronamespace='public'::regnamespace and p.proname not like 'zz_ref_%'",
  "select 'COLUMNS|' || table_name || '.' || column_name || '|' || ordinal_position || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default,'') from information_schema.columns where table_schema='public'",
  "select 'CONSTRAINTS|' || cl.relname || '|' || co.conname || '|' || pg_get_constraintdef(co.oid) from pg_constraint co join pg_class cl on cl.oid=co.conrelid where cl.relnamespace='public'::regnamespace",
  "select 'INDEXES|' || tablename || '|' || indexname || '|' || indexdef from pg_indexes where schemaname='public'",
  "select 'TRIGGERS|' || cl.relname || '|' || pg_get_triggerdef(t.oid) from pg_trigger t join pg_class cl on cl.oid=t.tgrelid where not t.tgisinternal and cl.relnamespace='public'::regnamespace",
  "select 'POLICIES|' || tablename || '|' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual,'') || '|' || coalesce(with_check,'') from pg_policies where schemaname='public'",
  "select 'RELATIONS|' || cl.relname || '|' || cl.relkind::text || '|' || coalesce(cl.relacl::text,'') || '|' || cl.relrowsecurity::text || '|' || cl.relowner::regrole::text || '|' || coalesce(obj_description(cl.oid,'pg_class'),'') from pg_class cl where cl.relnamespace='public'::regnamespace and cl.relkind in ('r','p','v','m','f','S')",
  "select 'COLUMNACL|' || cl.relname || '.' || a.attname || '|' || a.attacl::text from pg_attribute a join pg_class cl on cl.oid=a.attrelid where cl.relnamespace='public'::regnamespace and a.attacl is not null and not a.attisdropped",
  "select 'ENUMS|' || t.typname || '|' || string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace group by t.typname",
];
const snap = (label: string) => QUERIES.map((q) => `insert into snap(label, line) select '${label}', t.line from (${q}) t(line);`).join("\n");
const OWNED = "(talent_directory_search|talent_directory_promoted_ids)";
const diff = (x: string, y: string) => `select count(*) from (select line from snap where label='${x}' except select line from snap where label='${y}') d`;
const foreign = (x: string, y: string) => `select count(*) from (select line from snap where label='${x}' except select line from snap where label='${y}') d where d.line !~ '${OWNED}[(]'`;
const SEARCH = "'public.talent_directory_search(boolean,boolean,integer,integer,uuid)'::regprocedure";
const REF = "(select p.oid from pg_proc p where p.proname = 'zz_ref_talent_directory_search')";
const attrs = (oid: string) => `(select row(md5(prosrc), pg_get_function_arguments(oid), pg_get_function_result(oid), prosecdef, provolatile, proconfig, proacl, proowner, obj_description(oid,'pg_proc')) from pg_proc where oid = ${oid})`;

describe.skipIf(process.env.CI !== "true")("0268: rollback and re-apply on the local stack (CI only)", () => {
  const script = [
    "set lock_timeout = '10s';",
    "begin;",
    "create temp table snap(label text, line text);",
    snap("A"),
    body(ROLLBACK),
    snap("B"),
    reference0234(),
    `select 'R|search_is_0234|' || (${attrs(SEARCH)} is not distinct from ${attrs(REF)});`,
    `select 'R|b_helper|' || (select count(*) from pg_proc where proname = 'talent_directory_promoted_ids');`,
    `select 'R|b_section|' || (select count(*) from pg_proc p where p.oid = ${SEARCH} and pg_get_function_result(p.oid) like '%section%');`,
    "drop function public.zz_ref_talent_directory_search(boolean, boolean, integer, integer, uuid);",
    body(FORWARD),
    snap("C"),
    `select 'R|a_lines|' || (select count(*) from snap where label='A');`,
    `select 'R|c_missing|' || (${diff("A", "C")});`,
    `select 'R|c_extra|' || (${diff("C", "A")});`,
    `select 'R|a_not_b_foreign|' || (${foreign("A", "B")});`,
    `select 'R|b_not_a_foreign|' || (${foreign("B", "A")});`,
    `select 'R|a_not_b_owned|' || ((${diff("A", "B")}) - (${foreign("A", "B")}));`,
    `select 'R|a_has_section|' || (select count(*) from pg_proc p where p.oid = ${SEARCH} and pg_get_function_result(p.oid) like '%section%');`,
    "rollback;",
  ].join("\n");
  let out: ReturnType<typeof runSql>;
  let res: Record<string, string> = {};
  beforeAll(() => {
    out = runSql(script);
    res = Object.fromEntries(out.stdout.split("\n").filter((l) => l.startsWith("R|")).map((l) => l.split("|").slice(1) as [string, string]));
  });

  it("the script runs, on a database that has 0268 applied", () => {
    expect(out.ok, out.stderr).toBe(true);
    expect(Number(res.a_lines)).toBeGreaterThan(1500);
    expect(res.a_has_section, "start from a database that has 0268 applied").toBe("1");
  });
  it("the forward file run again after the rollback gives back exactly the applied state", () => {
    expect([res.c_missing, res.c_extra]).toEqual(["0", "0"]);
  });
  it("the rollback changes nothing but the two objects 0268 owns: not a table, a column, a grant, a policy or any other function", () => {
    expect([res.a_not_b_foreign, res.b_not_a_foreign]).toEqual(["0", "0"]);
    expect(Number(res.a_not_b_owned)).toBeGreaterThanOrEqual(2);
  });
  it("after the rollback the helper is gone and the search is the 0234 definition in every attribute that matters", () => {
    expect(res.b_helper).toBe("0");
    expect(res.b_section).toBe("0");
    expect(res.search_is_0234).toBe("true");
  });
});
