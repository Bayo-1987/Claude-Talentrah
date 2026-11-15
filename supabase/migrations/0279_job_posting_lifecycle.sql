-- 0279 (JOBS-LIFECYCLE-1, stage 1): the database half of "delete a closed job only when nothing references it, and keep a tombstone".
--
-- ── WHAT THIS ADDS (additive only; nothing existing is altered, dropped or deleted) ───────────────────────────────────────────────────────────
--   job_posting_lifecycle_runs   one row per lifecycle run (the audit trail the later waves write; the dry-run route writes nothing, by design). Service role only.
--   job_posting_tombstones       what is left of a deleted job: id, fingerprint, source, title, company, closed_at, deleted_at and the WHOLE row as jsonb, so a re-import and an old link can
--                                be answered and a delete can be undone. No foreign key to job_postings: it has to outlive the row it describes. Service role only.
--   job_posting_delete_unreferenced(uuid[], timestamptz, uuid)
--                                deletes the CLOSED rows among the ids it is given that are older than the cutoff AND that nothing references, and writes each tombstone, in ONE statement.
--   job_posting_reference_report()
--                                every foreign key that points at job_postings, read from the catalog, with whether the delete function checks it. The test and this migration's own
--                                self-check use it, so a table added later cannot be missed silently.
--   two feature_flags rows, both OFF: job_lifecycle_close_imports, job_lifecycle_delete_unreferenced. Nothing in this migration reads them; the code of the later waves does.
--
-- ── WHY ONE STATEMENT ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- The rule is "delete it only if nothing references it", and a read of the references followed by a delete is not that rule: a reference can arrive in between. So the check, the delete and the
-- tombstone are one query (the shape spend_credits_atomic, 0035, and auto_apply_claim_submission, 0034, use). The eligible rows are locked FOR UPDATE, so a second caller waits, then finds the row
-- gone and writes nothing: two concurrent calls cannot write two tombstones. A tombstone that cannot be written fails the statement, and the delete with it.
--   ACCEPTED RESIDUAL: a referencing row committed after this statement's snapshot but before its delete is not seen by the NOT EXISTS. For the CASCADE tables that child would go with the job. The
--   rows eligible here have been closed for a long time and the tables that matter (campaigns, reports, assessments, interviews) are not written for a closed job, so the window is a matter of
--   milliseconds on a row nobody is writing to; it is named here rather than claimed away.
--
-- ── THE LIST OF REFERENCES, AND WHAT IS EXEMPT ────────────────────────────────────────────────────────────────────────────────────────────────
-- 20 foreign keys point at job_postings: 19 on other tables and the self-link superseded_by (0202). Each one is classified, explicitly, in job_posting_reference_report():
--   BLOCKING (15)  the delete function checks them with a NOT EXISTS, so a closed job that any of them references is kept: applications (this is how a saved job is kept), resumes,
--                  job_tailoring_requests, applicant_messages, the assessments, submissions and screening questions, interview offers and bookings, ad campaigns and events, reports,
--                  auto_apply_queue, employer_applicant_notifications and the superseded_by self-link.
--   EXEMPT (5)     match_scores, country_default_events, apply_link_clicks, proactive_match_alerts, job_expiry_reminders. These hold derived data or telemetry; they go with the job (four cascade,
--                  country_default_events is set null). The function does NOT check them: a job whose only references are these is deleted, and its rows in them go with it.
-- THE CLASSIFICATION CANNOT GO STALE QUIETLY: the report derives the foreign keys from pg_constraint, the self-check below refuses to apply unless every one is checked OR exempt (and none is both), and
-- tests/rls/job-posting-lifecycle-delete.test.ts fails on any foreign key that is neither, so a table added later forces a decision.
--
-- ── GRANTS ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- Postgres grants EXECUTE on a new function to PUBLIC, and revoking from anon and authenticated alone does not remove that. Each function is revoked from public, anon and authenticated and granted to
-- service_role only. No policy calls either function (a function a policy calls must stay executable by the roles that evaluate the policy; these are called by the server only).
--
-- Additive, so it is applied BEFORE the code that calls it merges (supabase/migrations/README.md, "When to apply, relative to merging"). Rollback: supabase/rollbacks/0279_job_posting_lifecycle.rollback.sql.

set local lock_timeout = '3s';

create table public.job_posting_lifecycle_runs (
  id uuid primary key default gen_random_uuid(),
  wave text not null,
  mode text not null check (mode in ('dry_run', 'apply')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  counts jsonb not null default '{}'::jsonb,
  note text
);

comment on table public.job_posting_lifecycle_runs is
  '0279: one row per run of a job lifecycle wave (wave, mode, counts). Written by the server only; the dry-run route writes nothing. Service role only.';

alter table public.job_posting_lifecycle_runs enable row level security;
-- Deliberately NO policy: with row security on and none defined, every non-bypassing role is denied. The revoke is the second lock.
revoke all on public.job_posting_lifecycle_runs from public, anon, authenticated;
grant all on public.job_posting_lifecycle_runs to service_role;

create table public.job_posting_tombstones (
  job_id uuid primary key,
  dedup_fingerprint text,
  external_source text,
  title text not null,
  company_name text not null,
  closed_at timestamptz,
  deleted_at timestamptz not null default now(),
  run_id uuid references public.job_posting_lifecycle_runs (id) on delete set null,
  row_snapshot jsonb not null
);

create index job_posting_tombstones_fingerprint_idx on public.job_posting_tombstones (dedup_fingerprint);

comment on table public.job_posting_tombstones is
  '0279: what is left of a deleted job_postings row (id, fingerprint, source, title, company, closed_at, deleted_at, run, and the whole row as jsonb). No foreign key to job_postings: it outlives the row. Written only by job_posting_delete_unreferenced. Service role only.';

alter table public.job_posting_tombstones enable row level security;
revoke all on public.job_posting_tombstones from public, anon, authenticated;
grant all on public.job_posting_tombstones to service_role;

create or replace function public.job_posting_delete_unreferenced(p_ids uuid[], p_closed_before timestamptz, p_run_id uuid default null)
returns table (deleted_job_id uuid, deleted_banner_path text)
language sql
security definer
set search_path = ''
as $$
  with eligible as (
    select j.id
    from public.job_postings j
    where j.id = any (p_ids)
      and j.status = 'closed'::public.job_status
      and j.closed_at is not null
      and j.closed_at < p_closed_before
      and not exists (select 1 from public.ad_campaigns r where r.job_posting_id = j.id)
      and not exists (select 1 from public.ad_events r where r.job_posting_id = j.id)
      and not exists (select 1 from public.applicant_messages r where r.job_posting_id = j.id)
      and not exists (select 1 from public.application_assessment_submissions r where r.job_posting_id = j.id)
      and not exists (select 1 from public.applications r where r.job_posting_id = j.id)
      and not exists (select 1 from public.auto_apply_queue r where r.job_posting_id = j.id)
      and not exists (select 1 from public.employer_applicant_notifications r where r.job_posting_id = j.id)
      and not exists (select 1 from public.interview_bookings r where r.job_posting_id = j.id)
      and not exists (select 1 from public.interview_offers r where r.job_posting_id = j.id)
      and not exists (select 1 from public.job_posting_assessments r where r.job_posting_id = j.id)
      and not exists (select 1 from public.job_posting_reports r where r.job_posting_id = j.id)
      and not exists (select 1 from public.job_posting_screening_questions r where r.job_posting_id = j.id)
      and not exists (select 1 from public.job_postings r where r.superseded_by = j.id)
      and not exists (select 1 from public.job_tailoring_requests r where r.source_job_posting_id = j.id)
      and not exists (select 1 from public.resumes r where r.tailored_for_job_id = j.id)
    for update of j
  ),
  removed as (
    delete from public.job_postings d
    using eligible e
    where d.id = e.id
    returning d.*
  ),
  written as (
    insert into public.job_posting_tombstones (job_id, dedup_fingerprint, external_source, title, company_name, closed_at, deleted_at, run_id, row_snapshot)
    select d.id, d.dedup_fingerprint, d.external_source, d.title, d.company_name, d.closed_at, now(), p_run_id, to_jsonb(d)
    from removed d
    on conflict (job_id) do update
      set dedup_fingerprint = excluded.dedup_fingerprint,
          external_source = excluded.external_source,
          title = excluded.title,
          company_name = excluded.company_name,
          closed_at = excluded.closed_at,
          deleted_at = excluded.deleted_at,
          run_id = excluded.run_id,
          row_snapshot = excluded.row_snapshot
  )
  select d.id, d.banner_path from removed d
$$;

comment on function public.job_posting_delete_unreferenced(uuid[], timestamptz, uuid) is
  '0279: deletes the closed job_postings rows among p_ids with closed_at < p_closed_before that NO table references, and writes each one''s tombstone, in ONE statement. Returns the deleted ids and banner paths. Service role only.';

revoke all on function public.job_posting_delete_unreferenced(uuid[], timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.job_posting_delete_unreferenced(uuid[], timestamptz, uuid) to service_role;

create or replace function public.job_posting_reference_report()
returns table (referencing_table text, referencing_column text, on_delete text, checked boolean, exempt boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with def as (
    select pg_catalog.regexp_replace(pg_catalog.pg_get_functiondef('public.job_posting_delete_unreferenced(uuid[], timestamptz, uuid)'::regprocedure), '\s+', ' ', 'g') as body
  )
  select cl.relname::text,
         a.attname::text,
         case c.confdeltype when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT' end,
         pg_catalog.strpos(def.body, 'not exists (select 1 from public.' || cl.relname || ' r where r.' || a.attname || ' = j.id)') > 0,
         cl.relname::text = any (array['match_scores', 'country_default_events', 'apply_link_clicks', 'proactive_match_alerts', 'job_expiry_reminders'])
  from def,
       pg_catalog.pg_constraint c
       join pg_catalog.pg_class cl on cl.oid = c.conrelid
       join pg_catalog.pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
       join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.contype = 'f'
    and c.confrelid = 'public.job_postings'::regclass
  order by 1, 2
$$;

comment on function public.job_posting_reference_report() is
  '0279: every foreign key that points at job_postings, from the catalog, and whether job_posting_delete_unreferenced checks it. Service role only.';

revoke all on function public.job_posting_reference_report() from public, anon, authenticated;
grant execute on function public.job_posting_reference_report() to service_role;

insert into public.feature_flags (key, label, enabled) values
  ('job_lifecycle_close_imports', 'Close sheet imports with no stated deadline after 7 days', false),
  ('job_lifecycle_delete_unreferenced', 'Delete closed jobs that nothing references, keeping a tombstone', false)
on conflict (key) do nothing;

-- Guard: the function checks every foreign key into job_postings, both functions are closed to every role but the service role, both tables have row security on and no policy,
-- and the two flags are off.
do $$
declare
  v_missing text;
begin
  select string_agg(referencing_table || '.' || referencing_column, ', ') into v_missing
  from public.job_posting_reference_report() where not checked and not exempt;
  if v_missing is not null then
    raise exception '0279: foreign keys into job_postings that are neither checked by job_posting_delete_unreferenced nor exempt: %', v_missing;
  end if;
  select string_agg(referencing_table || '.' || referencing_column, ', ') into v_missing
  from public.job_posting_reference_report() where checked and exempt;
  if v_missing is not null then
    raise exception '0279: exempt tables must not be checked by job_posting_delete_unreferenced: %', v_missing;
  end if;
  if not exists (select 1 from public.job_posting_reference_report()) then
    raise exception '0279: the reference report found no foreign key into job_postings';
  end if;

  if has_function_privilege('anon', 'public.job_posting_delete_unreferenced(uuid[], timestamptz, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.job_posting_delete_unreferenced(uuid[], timestamptz, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.job_posting_reference_report()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.job_posting_reference_report()', 'EXECUTE') then
    raise exception '0279: anon and authenticated must not be able to EXECUTE the lifecycle functions';
  end if;
  if not has_function_privilege('service_role', 'public.job_posting_delete_unreferenced(uuid[], timestamptz, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.job_posting_reference_report()', 'EXECUTE') then
    raise exception '0279: service_role must be able to EXECUTE the lifecycle functions';
  end if;

  if (select count(*) from pg_class where oid in ('public.job_posting_tombstones'::regclass, 'public.job_posting_lifecycle_runs'::regclass) and relrowsecurity) <> 2 then
    raise exception '0279: row security must be on for both lifecycle tables';
  end if;
  if exists (select 1 from pg_policy where polrelid in ('public.job_posting_tombstones'::regclass, 'public.job_posting_lifecycle_runs'::regclass)) then
    raise exception '0279: the lifecycle tables must have no policy';
  end if;

  if (select count(*) from public.feature_flags where key in ('job_lifecycle_close_imports', 'job_lifecycle_delete_unreferenced') and not enabled) <> 2 then
    raise exception '0279: both lifecycle flags must exist and be OFF';
  end if;
end
$$;
