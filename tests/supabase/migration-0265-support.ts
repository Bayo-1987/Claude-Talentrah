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

/** Gives an admin the named permission through a role of its own (works on the scratch stand-ins and on the real tables). */
export const ROLE1 = "00000000-0000-4000-8000-0000000000e9";
export const grantPermissionSql = (admin: string, permission = "user_messaging", role = ROLE1) =>
  `insert into public.admin_roles (id, name) values ('${role}', 'n1-role-${role.slice(-4)}');\nupdate public.admin_users set role_id = '${role}' where id = '${admin}';\ninsert into public.admin_role_permissions (role_id, permission) values ('${role}', '${permission}');`;

/**
 * A zone whose local time is deep INSIDE quiet hours (01:00 to 04:00) and one deep OUTSIDE them (09:00 to 19:00), computed from the real now() of the transaction (N1-R26e), kept in two
 * session settings so a statement run through pg_temp.expect can read them. Some zone is always in each band, because the zones cover every hour of the day.
 */
export const ZONES_SQL = `select set_config('n1.zone_in', (select n.name from pg_catalog.pg_timezone_names n where (now() at time zone n.name)::time between time '01:00' and time '04:00' order by n.name limit 1), false);
select set_config('n1.zone_out', (select n.name from pg_catalog.pg_timezone_names n where (now() at time zone n.name)::time between time '09:00' and time '19:00' order by n.name limit 1), false);`;
export const ZONE_IN = "current_setting('n1.zone_in')";
export const ZONE_OUT = "current_setting('n1.zone_out')";
/** A device for `user` in the given zone expression (a SQL expression, for example ZONE_OUT, or a quoted literal). */
export const deviceZoneSql = (id: string, user: string, zoneExpr: string, extra = "") =>
  `insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth, ua_short, timezone${extra ? ", " + extra.split("=")[0] : ""}) values ('${id}', '${user}', 'https://push.example.invalid/${id}', 'k', 'a', 'Chrome', ${zoneExpr}${extra ? ", " + extra.split("=")[1] : ""});`;
/** A claim result as one token: id|null, then the refusal or a dash. The id itself is random and is never printed. */
export const claimTo = (name: string, args: string) =>
  `select 'R|${name}|' || (select case when c.id is null then 'null' else 'id' end || '/' || coalesce(c.refused, '-') from public.claim_notification(${args}) c);`;

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
 * WHAT THE SCRATCH DATABASE IS NOT. It is a stand-in for the parts of the real schema the migration points at: auth.users, auth.uid(), public.profiles with its sign-up trigger, public.admin_users,
 * the admin roles and permissions with the same admin_has_permission, user_notifications and the platform's default privileges. It is not the real schema. The real one is covered by migration-0265-applied.test.ts, which reads the APPLIED database and runs the behaviour that
 * depends on the real tables (deleting an admin, deleting a person) in a rolled-back transaction with no DDL in it.
 */
export const SCRATCH_BOOTSTRAP = `
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, instance_id uuid, aud text, role text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
create table public.profiles (id uuid primary key references auth.users (id) on delete cascade, email text, deletion_requested_at timestamptz, first_name text, last_name text, referral_leaderboard_display_name text, country text, created_at timestamptz not null default now(), last_active_at timestamptz);
-- Stand-in for the platform's QA-account test (migration 0240, immutable, null-safe): here an address under qa.example.test is a QA account. The real function is exercised by the applied-database test.
create function public.is_qa_account(p_email text, p_first text, p_last text, p_display text) returns boolean language sql immutable as $f$ select coalesce(p_email ilike '%@qa.example.test', false) $f$;
create table public.organizations (id uuid primary key default gen_random_uuid(), verified boolean not null default false);
create table public.organization_members (organization_id uuid not null references public.organizations (id) on delete cascade, user_id uuid not null references public.profiles (id) on delete cascade, primary key (organization_id, user_id));
create function public.handle_new_user() returns trigger language plpgsql as $f$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end
$f$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create type public.admin_permission as enum ('blog', 'operators', 'user_messaging');
create table public.admin_roles (id uuid primary key default gen_random_uuid(), name text not null unique);
create table public.admin_users (id uuid primary key references auth.users (id) on delete cascade, email text not null, role_id uuid references public.admin_roles (id), disabled_at timestamptz);
create table public.admin_role_permissions (role_id uuid not null references public.admin_roles (id) on delete cascade, permission public.admin_permission not null, primary key (role_id, permission));
create function public.admin_has_permission(p_admin uuid, p_permission public.admin_permission) returns boolean language sql stable security definer set search_path = public as $f$
  select exists (select 1 from public.admin_users u join public.admin_role_permissions p on p.role_id = u.role_id where u.id = p_admin and u.disabled_at is null and p.permission = p_permission);
$f$;
revoke all on function public.admin_has_permission(uuid, public.admin_permission) from public, anon, authenticated;
grant execute on function public.admin_has_permission(uuid, public.admin_permission) to service_role;
create table public.user_notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles (id) on delete cascade, read_at timestamptz);
create table public.email_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  job_match_digest boolean not null default true,
  unsubscribe_token text not null unique default md5(random()::text || clock_timestamp()::text),
  win_back_email boolean not null default true,
  updated_at timestamptz not null default now()
);
revoke all on table public.email_preferences from anon, authenticated;
create function public.profiles_ensure_email_preferences() returns trigger language plpgsql as $f$
begin
  insert into public.email_preferences (user_id) values (new.id) on conflict do nothing;
  return new;
end
$f$;
create trigger profiles_ensure_email_preferences after insert on public.profiles for each row execute function public.profiles_ensure_email_preferences();
create table public.feature_flags (key text primary key, label text not null, enabled boolean not null default false, updated_by uuid, updated_at timestamptz not null default now());
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

/* ---- the ten functions of the migration and what each must be ---- */

/** How Postgres prints an empty search_path setting. */
export const CONFIG = '{"search_path=\\"\\""}';
export const FUNCTIONS: Record<string, { definer: boolean; role: "service_role" | "authenticated" | "nobody"; callable: boolean }> = {
  notification_in_quiet_hours: { definer: false, role: "nobody", callable: false },
  claim_notification: { definer: true, role: "service_role", callable: true },
  release_notification: { definer: false, role: "service_role", callable: true },
  mark_notification_sent: { definer: false, role: "service_role", callable: true },
  stale_notification_claims: { definer: false, role: "service_role", callable: true },
  resolve_stale_claim: { definer: true, role: "service_role", callable: true },
  unread_notification_count: { definer: true, role: "service_role", callable: true },
  prune_notification_deliveries: { definer: false, role: "service_role", callable: true },
  register_push_subscription: { definer: true, role: "authenticated", callable: true },
  email_unsubscribe_stream: { definer: true, role: "service_role", callable: true },
  notification_revoke_devices_on_deletion_request: { definer: true, role: "nobody", callable: false },
  resolve_admin_segment: { definer: true, role: "service_role", callable: true },
  prepare_admin_message: { definer: true, role: "service_role", callable: true },
  submit_admin_message: { definer: true, role: "service_role", callable: true },
  approve_admin_message: { definer: true, role: "service_role", callable: true },
  cancel_admin_message: { definer: true, role: "service_role", callable: true },
  start_admin_message_send: { definer: true, role: "service_role", callable: true },
  admin_message_audit: { definer: true, role: "service_role", callable: true },
  record_admin_message_test: { definer: true, role: "service_role", callable: true },
  set_notification_setting: { definer: true, role: "service_role", callable: true },
  pause_admin_message_send: { definer: true, role: "service_role", callable: true },
  resume_admin_message_send: { definer: true, role: "service_role", callable: true },
  admin_email_eligible_recipients: { definer: true, role: "service_role", callable: true },
  notification_guard_append_only: { definer: false, role: "nobody", callable: false },
  notification_guard_message_edit: { definer: false, role: "nobody", callable: false },
};
export const NAMES = Object.keys(FUNCTIONS);
export const NAME_LIST = `(${NAMES.map((n) => `'${n}'`).join(", ")})`;

