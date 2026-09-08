-- 0120: a second way to earn `verified` — CAC business registration.
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
-- Today `organizations.verified` is set exactly one way: a confirmed account
-- email matching the claimed domain (0027, `evaluateDomainVerification`).
-- That excludes any employer whose confirmed email is not at their company's
-- domain — a personal-provider signup, or a domain that genuinely differs
-- from the one on the mailbox. This gives that employer a second route: submit
-- a CAC (Corporate Affairs Commission) registration number and business name,
-- which an admin manually confirms against
-- https://icrp.cac.gov.ng/public-search (no API, no automation — a human
-- checks a public government register and then decides).
--
-- Confirming does not touch `verified` by itself in this migration — that
-- write happens in the admin decision Server Action, under the new
-- `employer_verification` permission (0116). This migration only adds
-- somewhere for a submission and a confirmation to live.
--
-- ── WHY `cac_confirmed_by` POINTS AT `profiles`, NOT `admin_users` ────────
--
-- Exactly 0064's reasoning for `moderated_by` / `reviewed_by` / `removed_by`:
-- an admin whose account is later revoked or deleted should still resolve as
-- a named person in the trail, not dangle or cascade the row away.
-- `on delete set null` matches those columns' own behaviour.
--
-- ── COLUMN PRIVILEGES, ADDED INCREMENTALLY ─────────────────────────────────
--
-- Confirmed live against production: `organizations`' current `authenticated`
-- UPDATE grant is exactly `(name, domain, logo_url, description, updated_at)`
-- (0028). This ADDS to that list rather than re-issuing it — re-stating a
-- grant list is what silently dropped 0085's salary columns during 0107's
-- first draft on `job_postings` (see that migration's own postscript). The
-- employer may set `cac_number` and `cac_business_name` on their own row —
-- exactly what 0028's ownership-scoped RLS UPDATE policy already permits at
-- the row level, this only widens which columns.
--
-- `cac_confirmed_at` and `cac_confirmed_by` are trust columns of the same
-- shape as `unlisted_at` (0107) and `removed_at`/`removal_reason` (0056):
-- setting either is what lets an org claim `verified` through this route, so
-- neither gets a grant statement. 0028 already revoked table-level UPDATE and
-- re-granted a named column list, so anything added afterwards and left off
-- that list is withheld by default — the guard below asserts that rather than
-- re-stating a list that goes stale the moment another migration adds a
-- writable column.

alter table public.organizations
  add column cac_number text,
  add column cac_business_name text,
  add column cac_confirmed_at timestamptz,
  add column cac_confirmed_by uuid references public.profiles(id) on delete set null;

comment on column public.organizations.cac_number is
  'CAC (Corporate Affairs Commission) registration number the employer submitted for manual verification. Employer-writable (see grant below). Submitting does not set verified by itself — an admin confirms it against https://icrp.cac.gov.ng/public-search first.';

comment on column public.organizations.cac_business_name is
  'The registered business name the employer submitted alongside cac_number, for an admin to match against the CAC public register. Employer-writable.';

comment on column public.organizations.cac_confirmed_at is
  'When an admin manually confirmed cac_number against the CAC public register. Non-null is what the admin queue (0116''s employer_verification permission) uses to know a submission has already been decided. Service-role write only, like unlisted_at (0107) and removed_at (0056) — it is a trust column, not something the submitting employer may set.';

comment on column public.organizations.cac_confirmed_by is
  'The admin (profiles.id) who confirmed cac_number. References profiles, not admin_users, matching moderated_by/reviewed_by/removed_by (0064): an admin account later revoked should still resolve as a named person in the trail. Service-role write only.';

grant update (cac_number, cac_business_name) on public.organizations to authenticated;

-- Fails the migration if either trust column ever acquires an UPDATE grant for
-- a client role — the same guard shape 0107 used for unlisted_at, narrowed to
-- the two columns this migration is responsible for. cac_number and
-- cac_business_name are deliberately NOT checked here: they are supposed to be
-- authenticated-writable, and asserting the opposite would make this guard
-- fail on a correct migration.
do $$
begin
  if exists (
    select 1
    from information_schema.column_privileges cp
    where cp.table_schema = 'public'
      and cp.table_name = 'organizations'
      and cp.column_name in ('cac_confirmed_at', 'cac_confirmed_by')
      and cp.grantee in ('authenticated', 'anon')
      and cp.privilege_type = 'UPDATE'
  ) then
    raise exception
      'cac_confirmed_at/cac_confirmed_by is UPDATE-grantable by a client role. Setting either is a step toward verified; only the service role may write them.';
  end if;
end $$;

-- ── A SECOND, PRE-EXISTING HOLE, FOUND WHILE VERIFYING THIS ONE ───────────
--
-- Checked directly against a real database rather than assumed: 0028's
-- table-level REVOKE + column grant stops `verified` being touched by an
-- UPDATE, but it was never asked to stop an INSERT. `organizations`' INSERT
-- policy ("authenticated users can create an organization", baseline schema,
-- unchanged by 0026/0028) only checks `created_by = auth.uid()` — nothing in
-- it, or in any grant, constrains the VALUES a client may insert into any
-- column, because Supabase's default `INSERT` privilege is table-wide, not
-- column-scoped, and 0028 only ever revoked `UPDATE`.
--
-- Reproduced live, from a fresh authenticated session, before writing this
-- fix: `insert into organizations (name, created_by, verified) values (...,
-- auth.uid(), true)` succeeds and returns `verified: true`. That is exactly
-- the self-verification 0028 exists to prevent — reachable the whole time
-- through the row's creation instead of its update, which nothing before this
-- migration ever tested. `cac_confirmed_at`/`cac_confirmed_by` would inherit
-- the identical exposure the moment they exist: an insert naming both would
-- mint a self-attributed CAC confirmation with no admin ever involved, making
-- the entire review queue this feature builds optional.
--
-- Fixed here, not filed for later, because shipping 0120's two new trust
-- columns while knowingly leaving their insert path open would be worse than
-- not adding them: it would look reviewed. The policy gains a `with check` on
-- exactly the three columns that grant trust, `verified` included even though
-- it predates this migration — leaving it out while closing the two new
-- columns would be fixing the vulnerability for everything except the case
-- that matters most. `cac_number`/`cac_business_name` are deliberately NOT
-- constrained: they carry no trust, and 0120's grant already makes them
-- freely settable post-creation anyway, so restricting them at INSERT would
-- protect nothing.
--
-- The three columns are all nullable-or-defaulted (`verified boolean not null
-- default false`, the other two `timestamptz`/`uuid` defaulting to null), so
-- a normal insert that never mentions them keeps passing this check
-- unchanged — only an insert that explicitly smuggles a non-default value is
-- newly refused.
-- ── EXTENDS THE EXISTING `with check`, RATHER THAN RESTATING IT ──────────
--
-- The obvious version of this is a `drop policy` plus a `create policy` whose
-- `with check` spells out all four clauses. That is what this migration did
-- first, and it was wrong for the same reason 0107's postscript gives about
-- 0085: a hand-copied list is a SECOND COPY of something that lives somewhere
-- else, and the copy goes stale silently.
--
-- Concretely: `0114_organization_and_posting_insert_hardening` owns the base
-- clauses (`created_by`, `verified`). If any later migration adds a third one
-- there, this file would keep working and keep passing — it would simply stop
-- enforcing the new condition, because its hardcoded copy never learned about
-- it. Nothing would fail. That is exactly the shape that cost 0085 its four
-- salary grants, and 0114's own header asks this branch not to repeat it.
--
-- So the base expression is READ, not retyped. `pg_get_expr(polwithcheck, …)`
-- is the same lookup 0114's own assertion block uses to verify itself, and it
-- returns whatever the policy actually says at the moment this runs — three
-- clauses, or five, or the two it says today. This migration only ever ANDs
-- its own two onto the end.
--
-- Roles are read the same way and re-applied rather than assumed: recreating
-- an INSERT policy `to authenticated` when the original had been narrowed or
-- widened would be a silent privilege change smuggled in by a migration about
-- CAC numbers.
do $$
declare
  base_check text;
  policy_roles text;
begin
  select
    pg_get_expr(p.polwithcheck, p.polrelid),
    (select string_agg(quote_ident(r.rolname), ', ' order by r.rolname)
       from pg_roles r where r.oid = any (p.polroles))
  into base_check, policy_roles
  from pg_policy p
  where p.polrelid = 'public.organizations'::regclass
    and p.polname = 'authenticated users can create an organization';

  -- Absence is not "nothing to extend", it is a broken assumption: this
  -- migration would otherwise create a policy from scratch carrying ONLY its
  -- own two clauses, silently dropping the `created_by`/`verified` protection
  -- 0114 added. Refusing is the safe direction.
  if base_check is null then
    raise exception
      'the organizations INSERT policy is missing, so there is nothing to extend. 0114_organization_and_posting_insert_hardening should have created it; refusing to invent a replacement that would drop its clauses.';
  end if;

  -- `polroles` is `{0}` for PUBLIC, which resolves to no rows above. A policy
  -- that had been widened to PUBLIC is not something to quietly re-apply.
  if policy_roles is null then
    raise exception
      'the organizations INSERT policy applies to PUBLIC rather than a named role; refusing to re-create it blindly.';
  end if;

  execute 'drop policy "authenticated users can create an organization" on public.organizations';
  execute format(
    'create policy "authenticated users can create an organization" '
    'on public.organizations for insert to %s with check ((%s) and cac_confirmed_at is null and cac_confirmed_by is null)',
    policy_roles,
    base_check
  );
end $$;

-- Asserts the fix landed, rather than trusting the `create policy` above ran
-- clean: a silently-superseded or hand-edited-away policy would leave every
-- test in this file passing against a stale in-memory expectation. Checks the
-- policy's actual stored definition, not this file's copy of it.
do $$
declare
  final_check text;
  missing text[] := '{}';
  col text;
begin
  select pg_get_expr(polwithcheck, polrelid) into final_check
  from pg_policy
  where polrelid = 'public.organizations'::regclass
    and polname = 'authenticated users can create an organization';

  -- All FOUR, not just this migration's own two. The base clauses are the
  -- half that the extend-rather-than-restate rewrite above is protecting, so
  -- they are exactly the half worth asserting: a botched read of the existing
  -- expression would produce a policy carrying only `cac_confirmed_*`, which
  -- would look like a working migration and silently re-open 0114's hole.
  foreach col in array array['created_by', 'verified', 'cac_confirmed_at', 'cac_confirmed_by'] loop
    if final_check is null or final_check not ilike '%' || col || '%' then
      missing := missing || col;
    end if;
  end loop;

  if array_length(missing, 1) is not null then
    raise exception
      'the organizations INSERT policy is missing %; expected all of created_by, verified, cac_confirmed_at, cac_confirmed_by.',
      array_to_string(missing, ', ');
  end if;
end $$;
