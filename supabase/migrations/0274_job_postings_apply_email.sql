-- 0274 (PR-E1, apply by email, display only): one nullable column, job_postings.apply_email, the address a seeker sends their CV to when a posting has no company link.
--
-- Additive: nothing reads or writes it until the code of PR-E1 merges (the job page and the feed card show it, through src/lib/jobs/apply-email.ts, which refuses anything that is not one plain address). No backfill, no default,
-- no function or policy changed. Applied BEFORE that code merges (supabase/migrations/README.md, "When to apply, relative to merging").
--
-- READ: job_postings is readable by explicit column grant (0218), so a new column is NOT readable by anon or authenticated until a migration says so. It is public by design: it is shown on a public job page and is the
-- address an employer wants applicants to use. The grant below is that decision; tests/rls/job-postings-column-grants.test.ts fails without it.
-- WRITE: no client write grant is added. UPDATE is already revoked at table level (0056) and no column grant covers this column, so no client can change it. INSERT is different: authenticated holds a TABLE-level INSERT on
-- job_postings (0177, 0246), so an organisation member can set the column when creating an internal posting. That is harmless today (the pages show it only for a link-out posting, and the INSERT policy requires an
-- internal, non-imported posting) and is NOT closed here; PR-E2, which makes email an apply method, must close it (the INSERT policy's WITH CHECK, as 0246 did for the import columns).

-- Fail fast instead of queueing behind a long query on this table: the migration is retried, not waited for.
set local lock_timeout = '3s';

alter table public.job_postings
  add column if not exists apply_email text
  constraint job_postings_apply_email_length check (char_length(apply_email) <= 254);

grant select (apply_email) on public.job_postings to anon, authenticated;

-- Guard: the column exists with the right type and the length check, both API roles can read it, and neither can UPDATE it.
do $$
declare
  v_type text;
begin
  select data_type into v_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'job_postings' and column_name = 'apply_email';
  if v_type is distinct from 'text' then
    raise exception '0274: job_postings.apply_email is missing or not text (found %)', coalesce(v_type, 'no column');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.job_postings'::regclass and conname = 'job_postings_apply_email_length'
  ) then
    raise exception '0274: the length check job_postings_apply_email_length is missing';
  end if;

  if not has_column_privilege('anon', 'public.job_postings', 'apply_email', 'SELECT')
     or not has_column_privilege('authenticated', 'public.job_postings', 'apply_email', 'SELECT') then
    raise exception '0274: anon and authenticated must be able to SELECT job_postings.apply_email (the column grant is missing)';
  end if;

  if has_column_privilege('anon', 'public.job_postings', 'apply_email', 'UPDATE')
     or has_column_privilege('authenticated', 'public.job_postings', 'apply_email', 'UPDATE') then
    raise exception '0274: no client may UPDATE job_postings.apply_email';
  end if;
end
$$;
