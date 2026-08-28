-- 0060 — who the operator is, and how they prove it.
--
-- ── APPLIED BEFORE IT WAS COMMITTED. Read this first. ────────────────────
--
-- This file broke the working rule in supabase/migrations/README.md: write
-- the SQL here FIRST so a policy change can be reviewed in a diff, then apply
-- it. The SQL was written into this file first, but it went to both databases
-- on 2026-08-28 before any of it reached version control — so for the window
-- between then and this commit, a security-relevant grant/RLS change was live
-- on production with no reviewable diff anywhere. That is exactly the gap the
-- README exists to close, and it is recorded here rather than quietly fixed.
--
-- WHAT IS IN THE DATABASE IS WHAT IS BELOW, verified rather than asserted.
-- The applied text is stored in each project's
-- supabase_migrations.schema_migrations; stripping this file's comment lines
-- and all whitespace from both sides gives:
--
--   repo file            97b730c331b083194b8a5bf8318934cc  (3034 chars)
--   production applied   97b730c331b083194b8a5bf8318934cc  (3034 chars)
--
-- and production and CI hold byte-identical stored text
-- (md5 a89611842e57cc88d6316a30872afabb, 3569 chars, both projects). The only
-- difference between this file and what ran is these `--` comments, which the
-- apply call did not carry. Nothing below was rewritten after the fact.
--
-- Every admin surface in this project so far authenticates A SECRET, not a
-- PERSON. `requireAdminSecret` (src/lib/api/admin-auth.ts) compares one shared
-- string, so /api/admin/moderate-campaign records `reviewed_by = null` with a
-- comment saying, correctly, that a shared secret can prove "an operator" and
-- never "which operator". This migration is the identity those routes have
-- been missing.
--
-- ── WHY A SEPARATE TABLE AND NOT `profiles.is_admin` ─────────────────────
--
-- A flag on `profiles` would work today. 0030 revoked table-level UPDATE on
-- that table and granted back five named columns, so a new `is_admin` column
-- would not be writable by `authenticated` the moment it was added.
--
-- The objection is not that it would be wrong on the day it shipped. It is
-- that its safety would be a property of a GRANT LIST ON A TABLE THAT KEEPS
-- GROWING. `profiles` is the most user-writable table in the schema, its grant
-- list exists specifically so the Settings screen can widen it, and this
-- codebase has already produced four live findings in that exact mechanism
-- (0026, 0027, 0028, 0030) — two of them on this table and its sibling. One
-- `grant update (…, is_admin)` typed in a hurry, or one table-level grant that
-- silently overrides the column-level revoke, and a user can promote
-- themselves. CLAUDE.md's own standing rule says a value-bearing column added
-- to a user-writable table should fail tests/rls/column-privileges.test.ts
-- until someone decides deliberately; `is_admin` is the most value-bearing
-- column that could exist here, so the deliberate decision is: not on that
-- table.
--
-- These three tables instead have NO POLICIES AT ALL and have every privilege
-- revoked from `anon` and `authenticated`. Nothing a consumer session can do —
-- no policy, no grant, no PATCH — reaches them. Widening that is not a typo
-- away; it is SQL with the word "admin" in the diff.
--
-- ── WHY NOT A FULLY SEPARATE CREDENTIAL STORE ────────────────────────────
--
-- The other option was an `admin_users` table with its own password hash and
-- its own login, so that a bug anywhere in consumer auth could never grant
-- admin. That buys real isolation and costs hand-rolled password hashing,
-- session issuance, rotation and rate limiting. On this codebase's evidence
-- the likeliest source of a live vulnerability is our own security code, not
-- Supabase Auth's — so the split here is:
--
--   CREDENTIAL   -> Supabase Auth. Checked once, at /admin/login, by a client
--                   that does NOT write a session cookie. Nothing is reused.
--   AUTHORISATION-> `admin_users`, reachable only by the service role.
--   SESSION      -> `admin_sessions`, ours, revocable, short-lived, and
--                   completely independent of the seeker session cookie.
--
-- The practical consequence, and the point of doing it this way: BEING SIGNED
-- IN TO THE SEEKER APP GRANTS NOTHING. A stolen `sb-*` cookie does not reach
-- /admin, because the guard never looks at it. Reaching /admin requires
-- logging in again, at a different door, and produces a row here that can be
-- revoked from the database.
--
-- ── ATTRIBUTION ──────────────────────────────────────────────────────────
--
-- `admin_users.id` IS the `auth.users` id, which is also the `profiles` id.
-- That is deliberate rather than incidental: `ad_campaigns.reviewed_by` is a
-- foreign key to `profiles`, so wiring the hardcoded nulls in M2 needs the
-- admin identity to be a profiles id. Isolating the authorisation record did
-- not require inventing a second id space, and inventing one would have broken
-- the one attribution column that already exists.

create table public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  -- Denormalised for display and for the failed-login lookup below. It can
  -- drift from auth.users.email; nothing authenticates against it, so drift is
  -- cosmetic. Login resolves the admin by id, never by this column.
  email text not null,
  display_name text,
  -- Disabling beats deleting: an admin who leaves stops being able to log in
  -- while every audit row that names them stays readable.
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index admin_users_email_key on public.admin_users (lower(email));

comment on table public.admin_users is
  'Who may operate the admin dashboard. Service-role only: no policies, no grants to anon/authenticated. id is the auth.users/profiles id so attribution columns like ad_campaigns.reviewed_by can point at it.';

create table public.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  -- SHA-256 of the cookie value, never the value itself. A dump of this table
  -- is not a set of usable session cookies.
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  ip text
);

create index admin_sessions_admin_idx on public.admin_sessions (admin_user_id, created_at desc);
-- Supports the sweep of dead rows; also makes "who is currently logged in"
-- answerable without a seq scan once there is more than one operator.
create index admin_sessions_expiry_idx on public.admin_sessions (expires_at);

comment on table public.admin_sessions is
  'Live admin sessions. Independent of the Supabase seeker session — the /admin guard reads only this. Rows are revocable, which is the point: cutting off an operator is a DELETE, not a password reset.';

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  -- SET NULL, not CASCADE. The audit trail has to outlive the account it
  -- describes, which is why the email is snapshotted alongside it rather than
  -- joined for.
  admin_user_id uuid references public.admin_users(id) on delete set null,
  admin_email text,
  admin_session_id uuid references public.admin_sessions(id) on delete set null,
  action text not null,
  target_table text,
  target_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_target_idx on public.admin_audit_log (target_table, target_id);

comment on table public.admin_audit_log is
  'Append-only record of what an operator did, and as whom. M1 writes login/logout; M2 writes the moderation decisions that currently record reviewed_by = null.';

-- ── Lock all three away from every client role ───────────────────────────
--
-- RLS with no policy already denies, but a policy is one line away and a
-- revoked privilege is not. Both, on purpose — the distinction that produced
-- 0028 and 0030 is exactly this one.

alter table public.admin_users enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on public.admin_users from anon, authenticated;
revoke all on public.admin_sessions from anon, authenticated;
revoke all on public.admin_audit_log from anon, authenticated;

-- ── One statement decides whether a session is still good ────────────────
--
-- Four conditions have to hold together — the token matches, the session is
-- not revoked, it has not expired, and the admin is not disabled — and the
-- last_seen stamp has to move only if they do. Doing that as a SELECT followed
-- by an UPDATE in TypeScript is the same read-then-act shape that let
-- `spendCredits` double-spend for months (fixed in 0035). It is one UPDATE …
-- RETURNING here for the same reason.
--
-- SECURITY INVOKER (the default), deliberately. Only the service role calls
-- this, and the service role already bypasses RLS, so DEFINER would buy
-- nothing and would add another function whose EXECUTE grant matters — the
-- trap that 0027 fell into and 0032 had to undo. Invoker rights mean that even
-- if someone found a way to call this, the revokes above still refuse them.
--
-- Output names are prefixed so none of them collides with a real column name
-- in the query below.

create or replace function public.admin_session_validate(p_token_hash text)
returns table (
  session_id uuid,
  admin_id uuid,
  admin_email text,
  admin_display_name text,
  session_expires_at timestamptz
)
language sql
set search_path to 'public'
as $$
  update public.admin_sessions s
     set last_seen_at = now()
    from public.admin_users u
   where s.token_hash = p_token_hash
     and s.admin_user_id = u.id
     and s.revoked_at is null
     and s.expires_at > now()
     and u.disabled_at is null
  returning s.id, u.id, u.email, u.display_name, s.expires_at;
$$;

revoke all on function public.admin_session_validate(text) from public, anon, authenticated;
grant execute on function public.admin_session_validate(text) to service_role;

comment on function public.admin_session_validate(text) is
  'Validates and touches an admin session in one statement. Returns no row when the token is unknown, revoked, expired, or belongs to a disabled admin — the caller cannot tell those apart, and should not.';
