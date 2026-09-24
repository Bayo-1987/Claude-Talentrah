-- send-458 — ahead of Supabase's October 30 change: newly-created public
-- tables stop getting automatic Data API (PostgREST) access. Today it's
-- automatic, which is why most migrations in this repo never write a GRANT
-- and only write REVOKE when locking something down. Existing tables in an
-- existing database are grandfathered — but `.github/actions/local-supabase`
-- runs `supabase db reset` on every single checks/e2e job, replaying all 162
-- migrations from 0000_baseline_schema.sql forward, so CI never has an
-- "existing" database — from Oct 30 on, every CI run builds its database
-- under the NEW rule.
--
-- Checked against live grants (information_schema.role_table_grants /
-- role_column_grants on talentrah-preview), not guessed: these seven tables
-- have no explicit GRANT anywhere in their migration history, so their
-- current Data API access is entirely riding on the default that's going
-- away. This migration makes that access explicit — restoring what already
-- works today, not adding anything new. `authenticated`'s existing INSERT
-- refusal on the three analytics tables (tests/rls/cross-user.test.ts) is
-- untouched: none of these grants include INSERT/UPDATE/DELETE for them.
--
-- NOT touched here, and shouldn't be on the strength of this migration
-- alone: `service_role` has full privileges on every table with zero
-- explicit grants anywhere in 162 migrations — a schema-level Postgres
-- default (ALTER DEFAULT PRIVILEGES), a different mechanism from the
-- Data-API auto-grant actually being retired.
grant insert on public.job_posting_reports to authenticated;

grant select on public.course_recommendations to anon, authenticated;

grant select on public.blog_posts to anon, authenticated;

grant select on public.job_posting_assessment_files to anon, authenticated;
grant insert, update, delete on public.job_posting_assessment_files to authenticated;

grant select on public.country_default_events to authenticated;
grant select on public.resume_builder_start_events to authenticated;
grant select on public.farah_session_events to authenticated;

-- Hardening alongside the Oct 30 fix, not required for it: these three
-- analytics tables never had a REVOKE written for them, so `anon` has
-- always ridden the same broad default `authenticated` does — even though
-- every policy on them checks `auth.uid() = user_id`, which is always null
-- for anon, so anon was never actually permitted a row. Confirmed safe
-- before writing this: every read and write of these three tables anywhere
-- in this repo (src/, tests/, e2e/) goes through the service-role client
-- (src/lib/jobs/country-events.ts, src/lib/resume-builder/start-events.ts,
-- src/lib/farah/session-events.ts, all "server-only") — no anon-context or
-- session-client caller exists for any of them.
revoke all on public.country_default_events, public.resume_builder_start_events, public.farah_session_events
  from anon;

do $$
begin
  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_posting_reports'
      and grantee = 'authenticated' and privilege_type = 'INSERT'
  ) then
    raise exception 'job_posting_reports did not end up with authenticated INSERT';
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'course_recommendations'
      and grantee = 'anon' and privilege_type = 'SELECT'
  ) then
    raise exception 'course_recommendations did not end up with anon SELECT';
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'blog_posts'
      and grantee = 'anon' and privilege_type = 'SELECT'
  ) then
    raise exception 'blog_posts did not end up with anon SELECT';
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_posting_assessment_files'
      and grantee = 'authenticated' and privilege_type = 'INSERT'
  ) then
    raise exception 'job_posting_assessment_files did not end up with authenticated INSERT';
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'country_default_events'
      and grantee = 'authenticated' and privilege_type = 'SELECT'
  ) then
    raise exception 'country_default_events did not end up with authenticated SELECT';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'country_default_events'
      and grantee = 'anon'
  ) then
    raise exception 'country_default_events still has an anon grant after revoke';
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'resume_builder_start_events'
      and grantee = 'authenticated' and privilege_type = 'SELECT'
  ) then
    raise exception 'resume_builder_start_events did not end up with authenticated SELECT';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'resume_builder_start_events'
      and grantee = 'anon'
  ) then
    raise exception 'resume_builder_start_events still has an anon grant after revoke';
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'farah_session_events'
      and grantee = 'authenticated' and privilege_type = 'SELECT'
  ) then
    raise exception 'farah_session_events did not end up with authenticated SELECT';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'farah_session_events'
      and grantee = 'anon'
  ) then
    raise exception 'farah_session_events still has an anon grant after revoke';
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_posting_assessment_files'
      and grantee = 'anon' and privilege_type = 'SELECT'
  ) then
    raise exception 'job_posting_assessment_files did not end up with anon SELECT';
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_posting_assessment_files'
      and grantee = 'authenticated' and privilege_type = 'UPDATE'
  ) then
    raise exception 'job_posting_assessment_files did not end up with authenticated UPDATE';
  end if;

  if not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_posting_assessment_files'
      and grantee = 'authenticated' and privilege_type = 'DELETE'
  ) then
    raise exception 'job_posting_assessment_files did not end up with authenticated DELETE';
  end if;
end $$;
