/**
 * Shared helpers for the N1 migration tests (0264 and 0265). No test lives here.
 *
 * REPLAY. A migration test must not depend on what the stack happened to apply. `replay` builds one script that opens a transaction, runs the migration's own rollback file, runs the forward
 * file as it is on disk, runs the test's SQL, and ends in ROLLBACK, so a test sees the effect of the file in front of it and leaves nothing behind. A mutant is an edit to the file on disk:
 * every test replays the edited text. The rollback file is therefore exercised by every test, and it is written to be re-runnable (every statement is `if exists`).
 *
 * EXPECT. `pg_temp.expect(sql, sqlstate)` runs one statement in a subtransaction and answers `ok` when it fails with exactly that SQLSTATE, `NOT REFUSED` when it succeeds and `WRONG <state>`
 * otherwise, so one script can probe many refusals without aborting the transaction.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll } from "vitest";
import { createN1Scratch, dropN1Scratch, newScratchName, requireN1Db, runN1ScratchSql, runN1Sql, sweepStaleN1Scratch } from "./migration-0265-local-db";

export const ROOT = join(__dirname, "../..");
export const F0264 = "0264_user_messaging_permission.sql";
export const R0264 = "0264_user_messaging_permission.rollback.sql";
export const F0265 = "0265_notifications_and_admin_messaging.sql";
export const R0265 = "0265_notifications_and_admin_messaging.rollback.sql";

export const readMigration = (name: string) => readFileSync(join(ROOT, "supabase/migrations", name), "utf8");
export const readRollback = (name: string) => readFileSync(join(ROOT, "supabase/rollbacks", name), "utf8");

/** The SQL with `--` comments removed and whitespace collapsed. */
export function code(sql: string): string {
  return sql
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits on semicolons that are not inside a dollar-quoted body, so a `do` block or a function body counts as one statement. */
export function statements(sql: string): string[] {
  const c = code(sql);
  const out: string[] = [];
  let cur = "";
  let tag: string | null = null;
  for (let i = 0; i < c.length; i++) {
    if (tag === null) {
      const m = /^\$[A-Za-z_]*\$/.exec(c.slice(i));
      if (m) {
        tag = m[0];
        cur += tag;
        i += tag.length - 1;
        continue;
      }
      if (c[i] === ";") {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
        continue;
      }
    } else if (c.startsWith(tag, i)) {
      cur += tag;
      i += tag.length - 1;
      tag = null;
      continue;
    }
    cur += c[i];
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** True when the SQL casts, compares or passes `label` as the admin_permission type (the use Postgres refuses, 55P04, in the transaction that adds it). Text reads do not count. */
export function usesNewValueAsEnum(sql: string, label: string): boolean {
  const c = code(sql);
  const q = `'${label}'`;
  return (
    new RegExp(`${q}\\s*::\\s*(public\\.)?admin_permission`, "i").test(c) ||
    new RegExp(`cast\\s*\\(\\s*${q}\\s+as\\s+(public\\.)?admin_permission`, "i").test(c) ||
    new RegExp(`admin_permission\\s*${q}`, "i").test(c) ||
    new RegExp(`(permission|enumlabel)\\s*(=|<>|!=|in\\s*\\()\\s*\\(?\\s*${q}`, "i").test(c.replace(/(permission|enumlabel)\s*::\s*text/gi, "$1_as_text"))
  );
}

export const EXPECT_FN = `create function pg_temp.expect(stmt text, want text, want_hint text default null) returns text language plpgsql as $expect$
declare h text; st text;
begin
  execute stmt;
  return 'NOT REFUSED';
exception when others then
  st := sqlstate;
  get stacked diagnostics h = pg_exception_hint;
  if st = want and (want_hint is null or h = want_hint) then return 'ok'; end if;
  return 'WRONG ' || st || ' hint=' || coalesce(h, '') || ' ' || sqlerrm;
end
$expect$;
create function pg_temp.errtext(stmt text) returns text language plpgsql as $errtext$
begin
  execute stmt;
  return 'NOT REFUSED';
exception when others then
  return sqlerrm;
end
$errtext$;
create function pg_temp.rows(stmt text) returns text language plpgsql as $rows$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n::text;
exception when others then
  return 'ERR ' || sqlstate;
end
$rows$;`;

/** The fixed fixture ids the table tests use. */
export const U1 = "00000000-0000-4000-8000-0000000000a1";
export const U2 = "00000000-0000-4000-8000-0000000000a2";
export const A1 = "00000000-0000-4000-8000-0000000000b1";
export const A2 = "00000000-0000-4000-8000-0000000000b2";
export const M1 = "00000000-0000-4000-8000-0000000000c1";
export const M2 = "00000000-0000-4000-8000-0000000000c2";
export const D1 = "00000000-0000-4000-8000-0000000000d1";
export const D2 = "00000000-0000-4000-8000-0000000000d2";
export const S1 = "00000000-0000-4000-8000-0000000000e1";

const q = (sql: string) => `'${sql.replace(/'/g, "''")}'`;
/** A result line `R|<name>|ok` when the statement fails with exactly `sqlstate` (and `hint`, when given). */
export const probe = (name: string, stmt: string, sqlstate: string, hint?: string) =>
  `select 'R|${name}|' || pg_temp.expect(${q(stmt)}, '${sqlstate}'${hint ? `, '${hint}'` : ""});`;
/** A result line `R|<name>|<rows affected>` (or `ERR <sqlstate>`) for one statement. */
export const rowsOf = (name: string, stmt: string) => `select 'R|${name}|' || pg_temp.rows(${q(stmt)});`;
/** A result line `R|<name>|<value>` for a scalar query. */
export const scalar = (name: string, query: string) => `select 'R|${name}|' || coalesce((${query})::text, 'NULL');`;
/** Runs `lines` as a database role (with a signed-in person when `sub` is given), then returns to the owner. */
export function asRole(role: "anon" | "authenticated" | "service_role", lines: string[], sub?: string) {
  return [
    `set local role ${role};`,
    sub ? `select set_config('request.jwt.claims', '{"sub":"${sub}","role":"${role}"}', true);` : "",
    ...lines,
    "reset role;",
  ].join("\n");
}

/** Fixture rows: a person (the profile is made by the signup trigger) and an admin. */
export function personSql(id: string, email = `${id}@example.test`) {
  return `insert into auth.users (id, email, instance_id, aud, role) values ('${id}', '${email}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');`;
}
export function adminSql(id: string, email = `${id}@example.test`) {
  return `${personSql(id, email)}\ninsert into public.admin_users (id, email) values ('${id}', '${email}');`;
}
export const FIXTURES = [personSql(U1), personSql(U2), adminSql(A1), adminSql(A2)].join("\n");

/** A valid draft message created by A1. */
export const draftSql = (id = M1) =>
  `insert into public.admin_messages (id, created_by, created_by_email, kind, title, body, channels, segment_key) values ('${id}', '${A1}', 'a1@example.test', 'service_announcement', 'Title', 'Body', array['inapp'], 'everyone');`;
/** A valid device for U1. */
export const deviceSql = (id = D1, user = U1, endpoint = `https://push.example.invalid/${id}`) =>
  `insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, ua_short) values ('${id}', '${user}', '${endpoint}', 'k', 'a', 'Chrome on Android');`;

/**
 * WHERE A REPLAY RUNS. Not in the shared `postgres` database. A replay drops and re-creates tables that refer to profiles, admin_users and auth.users, which takes heavy locks on those
 * tables, and the auth service (creating and deleting users for every other suite) deadlocked with it (40P01, in two whole-suite runs; the database log names `create policy
 * push_subscriptions_select_own` and `drop table ... admin_messages` against the auth service's INSERT and DELETE on auth.users and public.profiles). So a replay runs in a PRIVATE database
 * on the same stack, one per test file, created on first use and dropped when the file ends. It shares no table, row or lock with any other suite.
 *
 * WHAT THE SCRATCH DATABASE IS NOT. It is a stand-in for the parts of the real schema the migration points at: auth.users, auth.uid(), public.profiles with its sign-up trigger, public.admin_users
 * and the platform's default privileges. It is not the real schema. The real one is covered by migration-0265-applied.test.ts, which reads the APPLIED database and runs the behaviour that
 * depends on the real tables (deleting an admin, deleting a person) in a rolled-back transaction with no DDL in it.
 */
export const SCRATCH_BOOTSTRAP = `
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, instance_id uuid, aud text, role text);
create function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
create table public.profiles (id uuid primary key references auth.users (id) on delete cascade, email text);
create function public.handle_new_user() returns trigger language plpgsql as $f$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end
$f$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create table public.admin_users (id uuid primary key references auth.users (id) on delete cascade, email text not null);
create table public.email_preferences (user_id uuid primary key references public.profiles (id) on delete cascade);
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
`;

let scratch: string | null = null;
function scratchDb(): string {
  if (scratch === null) {
    sweepStaleN1Scratch();
    const name = newScratchName();
    createN1Scratch(name, SCRATCH_BOOTSTRAP);
    scratch = name;
  }
  return scratch;
}
afterAll(() => {
  if (scratch !== null) {
    const name = scratch;
    scratch = null;
    dropN1Scratch(name);
  }
});

function resultsOf(r: { ok: boolean; stdout: string; stderr: string }) {
  const res: Record<string, string> = {};
  for (const line of r.stdout.split("\n")) {
    const m = /^R\|([^|]+)\|(.*)$/.exec(line.trim());
    if (m) res[m[1]] = m[2];
  }
  return { ...r, res };
}

/**
 * Runs `body` after rolling back and re-applying 0265 as it is on disk, in a PRIVATE scratch database, all in one transaction that is rolled back. A test reports a result by selecting a line
 * `R|<name>|<value>`; `res` maps each name to its value (psql's own command tags are ignored). When the script fails, `ok` is false and `stderr` carries the SQLSTATE.
 */
export function replay0265(body: string, opts: { forward?: string; rollback?: string; prelude?: string } = {}) {
  requireN1Db();
  const forward = opts.forward ?? readMigration(F0265);
  const rollback = opts.rollback ?? readRollback(R0265);
  const script = `begin;\n${rollback}\n${opts.prelude ?? ""}\n${forward}\n${EXPECT_FN}\n${body}\nrollback;`;
  return resultsOf(runN1ScratchSql(scratchDb(), script));
}

/**
 * Runs `body` against the APPLIED database (the real schema, 0265 already applied by the migration runner) in one transaction that always rolls back. There is NO DDL in it, so it takes only
 * row locks and never waits for or blocks another suite. The body must not create, alter or drop anything.
 */
export function applied0265(body: string) {
  requireN1Db();
  return resultsOf(runN1Sql(`begin;\n${EXPECT_FN}\n${body}\nrollback;`));
}

export const last = (out: string) => out.trim().split("\n").pop();

/**
 * SIMULATION of the Data API change (the existing-project model, grants addendum G5): the stack's default privileges give every new table, sequence and function in `public` to anon,
 * authenticated and service_role. This switches those defaults off, for the schema and globally, for the role that creates the objects, so a migration that leans on them shows it.
 * LIMITS: it is an approximation of a platform behaviour. It does not reproduce a brand-new project, whose clean replay aborts at migration 0211, and it cannot show what the real
 * platform does to a role other than the creating one.
 */
export const NO_DEFAULT_GRANTS = ["tables", "sequences", "functions"]
  .flatMap((kind) => [
    `alter default privileges for role postgres in schema public revoke all on ${kind} from anon, authenticated, service_role;`,
    `alter default privileges for role postgres revoke all on ${kind} from anon, authenticated, service_role;`,
  ])
  .join("\n");

/* ---- expectations shared by the replay tests and the applied-database test ---- */

export const TABLES = ["notification_deliveries", "push_subscriptions", "admin_messages", "admin_message_recipients", "admin_message_events", "notification_settings", "notification_setting_changes"] as const;
export const IN_LIST = `(${TABLES.map((t) => `'${t}'`).join(", ")})`;
export const FOUR = "DELETE,INSERT,SELECT,UPDATE";
/** The exact grants (role: privileges) per table. The owner's own privileges are not listed. */
export const EXPECTED_GRANTS: Record<(typeof TABLES)[number], string> = {
  notification_deliveries: `service_role:${FOUR}`,
  push_subscriptions: `authenticated:DELETE service_role:${FOUR}`,
  admin_messages: `service_role:${FOUR}`,
  admin_message_recipients: `service_role:${FOUR}`,
  admin_message_events: "service_role:INSERT,SELECT",
  notification_settings: "service_role:SELECT",
  notification_setting_changes: "service_role:INSERT,SELECT",
};
export const SAFE_COLUMNS = "created_at,id,last_seen_at,revoked_at,ua_short";
export const OTHER_TABLES = TABLES.filter((t) => t !== "push_subscriptions");

export const grantMatrix = () =>
  TABLES.map((t) =>
    scalar(
      `grants_${t}`,
      `select coalesce(string_agg(who || ':' || privs, ' ' order by who), 'none') from (
         select coalesce(g.rolname, 'PUBLIC') as who, string_agg(a.privilege_type, ',' order by a.privilege_type) as privs
           from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles g on g.oid = a.grantee
          where c.relnamespace = 'public'::regnamespace and c.relname = '${t}' and a.grantee <> c.relowner
          group by 1) s`,
    ),
  ).join("\n");

export const columnGrants = [
  scalar("safe_columns", `select string_agg(a.attname, ',' order by a.attname) from pg_attribute a cross join lateral aclexplode(a.attacl) x join pg_roles g on g.oid = x.grantee where a.attrelid = 'public.push_subscriptions'::regclass and g.rolname = 'authenticated' and x.privilege_type = 'SELECT'`),
  scalar("column_grants_elsewhere", `select count(*) from pg_attribute a cross join lateral aclexplode(a.attacl) x where a.attrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and relname in ${IN_LIST}) and not (a.attrelid = 'public.push_subscriptions'::regclass and x.grantee = (select oid from pg_roles where rolname = 'authenticated') and x.privilege_type = 'SELECT')`),
].join("\n");


export const functionAcl = scalar(
      "function_execute",
  `select coalesce(string_agg(p.proname || ':' || coalesce(g.rolname, 'PUBLIC'), ' ' order by p.proname, g.rolname), 'none')
     from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a left join pg_roles g on g.oid = a.grantee
    where p.pronamespace = 'public'::regnamespace and p.proname in ('notification_guard_append_only', 'notification_guard_message_edit') and a.grantee <> p.proowner`,
);

export type Col = [name: string, type: string, nullable: "nn" | "null", dflt: string];
const GEN = "gen_random_uuid()";
const NOW = "now()";
export const COLUMNS: Record<string, Col[]> = {
  notification_deliveries: [
    ["id", "uuid", "nn", GEN], ["user_id", "uuid", "nn", ""], ["kind", "text", "nn", ""], ["subject_id", "uuid", "nn", ""], ["device_id", "uuid", "null", ""],
    ["channel", "text", "nn", ""], ["claimed_at", "timestamp with time zone", "nn", NOW], ["sent_at", "timestamp with time zone", "null", ""], ["released_at", "timestamp with time zone", "null", ""],
  ],
  push_subscriptions: [
    ["id", "uuid", "nn", GEN], ["user_id", "uuid", "nn", ""], ["endpoint", "text", "nn", ""], ["p256dh", "text", "nn", ""], ["auth", "text", "nn", ""], ["ua_short", "text", "nn", ""],
    ["timezone", "text", "nn", "'Africa/Lagos'::text"], ["created_at", "timestamp with time zone", "nn", NOW], ["last_seen_at", "timestamp with time zone", "nn", NOW],
    ["revoked_at", "timestamp with time zone", "null", ""], ["revoke_reason", "text", "null", ""],
  ],
  admin_messages: [
    ["id", "uuid", "nn", GEN], ["created_by", "uuid", "null", ""], ["created_by_email", "text", "nn", ""], ["kind", "text", "nn", ""], ["title", "text", "nn", ""], ["body", "text", "nn", ""],
    ["link_path", "text", "null", ""], ["channels", "_text", "nn", ""], ["segment_key", "text", "nn", ""], ["segment_params", "jsonb", "nn", "'{}'::jsonb"], ["consent_line", "text", "null", ""],
    ["status", "text", "nn", "'draft'::text"], ["requires_approval", "boolean", "nn", "true"], ["audience_count", "integer", "nn", "0"], ["sent_count", "integer", "nn", "0"],
    ["failed_count", "integer", "nn", "0"], ["skipped_count", "integer", "nn", "0"], ["kind_confirmed_by_approver", "text", "null", ""], ["approved_by", "uuid", "null", ""],
    ["approved_by_email", "text", "null", ""], ["sent_started_at", "timestamp with time zone", "null", ""], ["created_at", "timestamp with time zone", "nn", NOW],
  ],
  admin_message_recipients: [
    ["id", "uuid", "nn", GEN], ["message_id", "uuid", "nn", ""], ["user_id", "uuid", "nn", ""], ["to_inapp", "boolean", "nn", "false"], ["to_push", "boolean", "nn", "false"],
    ["to_email", "boolean", "nn", "false"], ["push_outcome", "text", "null", ""], ["email_outcome", "text", "null", ""],
  ],
  admin_message_events: [
    ["id", "uuid", "nn", GEN], ["message_id", "uuid", "null", ""], ["event", "text", "nn", ""], ["detail", "jsonb", "nn", "'{}'::jsonb"], ["actor_admin_id", "uuid", "null", ""],
    ["actor_email", "text", "null", ""], ["at", "timestamp with time zone", "nn", NOW],
  ],
  notification_settings: [
    ["key", "text", "nn", ""], ["int_value", "integer", "nn", ""], ["updated_by_email", "text", "null", ""], ["updated_at", "timestamp with time zone", "nn", NOW],
  ],
  notification_setting_changes: [
    ["id", "uuid", "nn", GEN], ["key", "text", "nn", ""], ["old_value", "integer", "null", ""], ["new_value", "integer", "nn", ""], ["actor_admin_id", "uuid", "null", ""],
    ["actor_email", "text", "null", ""], ["at", "timestamp with time zone", "nn", NOW],
  ],
};

export const columnsQuery = (table: string) =>
  scalar(
    `cols_${table}`,
    `select string_agg(column_name || ' ' || case when data_type = 'ARRAY' then udt_name else data_type end || ' ' || case when is_nullable = 'NO' then 'nn' else 'null' end || ' ' || coalesce(column_default, ''), ' ; ' order by ordinal_position)
       from information_schema.columns where table_schema = 'public' and table_name = '${table}'`,
  );
export const expectedColumns = (table: string) => COLUMNS[table].map(([n, t, nn, d]) => `${n} ${t} ${nn} ${d}`.trimEnd()).join(" ; ");
export const normalise = (s: string | undefined) => (s ?? "").split(" ; ").map((c) => c.trimEnd()).join(" ; ");

