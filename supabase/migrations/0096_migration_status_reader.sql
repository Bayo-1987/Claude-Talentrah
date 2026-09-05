-- 0096 — Read-only, HTTPS-reachable production migration status, for the
-- automated drift check (scripts/check-migration-drift.ts).
--
-- WHY THIS EXISTS. 0093 landed on `main` with #215, was applied to the CI
-- project, and was never applied to production — the PR description said
-- "production untouched, migrates on merge," and the merge itself carries no
-- such step, because there is no automated production migration mechanism in
-- this repo at all. It sat unrecorded until the founder's own direct query
-- caught it. This function is what an automated check calls to catch that
-- gap on its own, on every push to `main` and once a day.
--
-- WHY HTTPS, NOT A DIRECT POSTGRES CONNECTION. An earlier attempt at this
-- same problem created a `migration_auditor` role scoped to SELECT on
-- `supabase_migrations.schema_migrations` and connected through Supavisor's
-- hosted shared pooler. That hit a dead end: the pooler doesn't reliably
-- route custom roles ("tenant/user ... not found", reproduced 8 times over 2
-- minutes — not propagation lag), and the direct connection is IPv6-only,
-- which GitHub Actions cannot reach at all. `migration_auditor` is dropped in
-- this same migration.
--
-- WHY A SECURITY DEFINER FUNCTION IN public. `supabase_migrations` is not a
-- schema PostgREST exposes — confirmed directly (`Invalid schema:
-- supabase_migrations` when a prior attempt tried reaching it via the
-- service-role client). A SECURITY DEFINER function in `public` is the same
-- pattern this project already uses to reach something the caller's own role
-- can't see directly: promoted_jobs (0052), internal_applicant_counts
-- (0059), delete_resume_with_snapshot (0094).
--
-- WHY THIS IS NOT "A DEDICATED ROLE" IN THE LITERAL SENSE — A REAL PLATFORM
-- CONSTRAINT DISCOVERED WHILE BUILDING THIS, NOT A DESIGN CHOICE. The
-- original plan was a genuinely separate Postgres role, reachable only by
-- its own pre-signed JWT — the same pattern this file's own migration once
-- tried. `grant migration_status_reader to authenticator` fails on hosted
-- Supabase: "authenticator is a reserved role, only superusers can modify
-- it". Confirmed directly, not assumed — PostgREST's role-switching requires
-- the target role to be a member the `authenticator` role can `SET ROLE`
-- into, and granting that membership is blocked for a project's own owner on
-- the hosted platform, full stop; there is no flag or dashboard setting that
-- unlocks it for a newly created role. Custom Postgres roles exposed to
-- PostgREST are simply not a thing this platform lets a project owner
-- provision for themselves.
--
-- The mechanism below is Supabase's own documented answer to exactly this
-- shape of problem (see "Enforce additional rules on each request" /
-- "Use additional API keys" in the Data API guide): the JWT's `role` claim
-- has to be one PostgREST already knows how to become — `anon`, here, since
-- `authenticated` would additionally make this callable by every signed-in
-- seeker and employer's own session, which is a wider door than a
-- CI-only credential should open even though the data behind it is harmless
-- — and the function itself checks a SECOND, custom claim
-- (`purpose = 'migration-status-reader'`) before returning anything,
-- rejecting every other caller with a 403 including a plain request bearing
-- only the public anon key. The PRACTICAL result is what "a dedicated role"
-- was meant to buy: only a caller holding this specific pre-signed JWT gets
-- data back. What's granted at the Postgres level is EXECUTE to `anon`; what
-- actually gates access is the claim check inside the function body. Anyone
-- reading only the GRANT line would see something that looks like the exact
-- "anon" habit this was built to avoid — this comment is why it isn't one.
--
-- The underlying data is still not sensitive regardless: a list of migration
-- filenames already sitting in this repo's own PUBLIC git history. The
-- reasoning for gating it at all was never about protecting that list — it's
-- about not normalising "the caller only had the anon key" as a sufficient
-- answer in a codebase whose main safety property is RLS discipline.
--
-- Reached with a JWT minted offline (scripts/mint-migration-status-jwt.ts)
-- from the project's JWT secret, which never touches CI or this repository —
-- only the resulting token does.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'migration_auditor') then
    revoke select on supabase_migrations.schema_migrations from migration_auditor;
    revoke usage on schema supabase_migrations from migration_auditor;
    drop role migration_auditor;
  end if;
end
$$;

create or replace function public.list_applied_migrations()
returns table (name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if coalesce(
       (current_setting('request.jwt.claims', true)::json ->> 'purpose'),
       ''
     ) <> 'migration-status-reader' then
    raise sqlstate 'PGRST' using
      message = json_build_object(
        'message', 'Not authorized to call list_applied_migrations.'
      )::text,
      detail = json_build_object('status', 403)::text;
  end if;

  return query
    select sm.name from supabase_migrations.schema_migrations sm where sm.name is not null;
end;
$$;

revoke all on function public.list_applied_migrations() from public, authenticated, service_role;
grant execute on function public.list_applied_migrations() to anon;
