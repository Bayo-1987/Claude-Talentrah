-- 0254: new-applicant notifications for employers (NEW-APPLICANT NOTIFICATIONS, owner spec 10 Oct 2026; number assigned by the owner).
-- PREREQUISITE: 0251 (the QA rule that also covers the owner's stonebridgehibr1+...@gmail.com test accounts) must be applied FIRST; this migration calls public.is_qa_account (0240, widened by 0251). Without 0251 the owner's test accounts would trigger employer emails.
--
-- WHAT IT DOES. When an application reaches the stage 'applied' on an INTERNAL posting of an organisation, ONE notification row is recorded for that application, however many times its stage changes afterwards. The application then reaches the employer in one of two ways: the FIRST
-- real applicant of a job is emailed at once, every other one waits for the daily digest at 08:00 Nigeria time (07:05Z). Each organisation member chooses instant (the default), digest or off. QA accounts never produce an email, as applicant or as recipient. The email itself
-- (applicant name, job title, a link; nothing from the CV) is application code through the existing sender; this migration is the bookkeeping that makes "once" true.
--
-- WHAT IT ADDS (new objects; one new column; two small AFTER triggers on applications):
--   public.employer_applicant_notifications   id; application_id UNIQUE (FK applications, cascade): ONE row per application; job_posting_id; organization_id; is_first; suppressed_reason (qa_applicant); created_at; instant_sent_at; digested_at.
--                                             UNIQUE (job_posting_id) WHERE is_first: the first applicant of a job is decided by the DATABASE, so two people applying in the same instant cannot both be "first". A QA applicant is never first and never emailed.
--   trigger functions record_new_applicant_notification()  (AFTER INSERT and AFTER UPDATE OF stage on applications, only when the stage becomes 'applied'). It never blocks the person's application: any error is swallowed with a warning and the application succeeds (the notification is simply not recorded).
--   claim_applicant_instant / release_applicant_instant    claim the instant email for the first applicant exactly once (conditional UPDATE), release it if the send failed.
--   claim_applicant_digest / release_applicant_digest      claim a batch of unsent notifications exactly once (conditional UPDATE, skip locked: two overlapping cron runs get disjoint rows), release them if the send failed. Each claimed row says already_announced = true when it
--                                                          was the first applicant AND its instant email went out: a recipient on 'instant' must NOT see it again in the digest; a recipient on 'digest' never got the instant email and DOES see it.
--   new_applicant_recipients(organisation)                 who may be emailed for an organisation: members whose account is not scheduled for deletion, who have an email, whose setting is not 'off', and who are not QA accounts; with their mode.
--   email_preferences.new_applicant_notice                 text 'instant' | 'digest' | 'off', default 'instant'. The preferences table is service-role only (0083), so the new column is too.
--
-- WHAT IT DOES NOT DO. It does not backfill: applications made before this exists get no notification (nobody is emailed about the past). The "N new" counts on the employer's pages need no schema: they come from employer_applicant_status (an application with no row or status 'new') and first_viewed_at (0126).
-- ORGANISATION TIME: organisations have no timezone column, so "08:00 employer time" is 08:00 Nigeria (UTC+1) = 07:05Z for everyone, from a daily cron; a timezone on organisations would be a later migration.
--
-- ACCESS. RLS on, ALL privileges revoked from anon and authenticated, no policies: only the server with the service role reads or writes the table. All functions are SECURITY DEFINER with an empty search_path; EXECUTE for service_role only (the trigger functions for nobody).
-- ACCOUNT DELETION. No foreign key points at a person: the table hangs on applications and organisations (both cascade), so an applicant's rows go with their applications and nothing needs a new row in docs/account-deletion-map.md.
-- ADDITIVE for the running app: nothing deployed names any of this; applied BEFORE the code that uses it merges. Exact undo: supabase/rollbacks/0254_new_applicant_notifications.rollback.sql.

create table public.employer_applicant_notifications (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null unique references public.applications (id) on delete cascade,
  job_posting_id    uuid not null references public.job_postings (id) on delete cascade,
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  is_first          boolean not null default false,
  suppressed_reason text check (suppressed_reason in ('qa_applicant')),
  created_at        timestamptz not null default now(),
  instant_sent_at   timestamptz,
  digested_at       timestamptz,
  constraint employer_applicant_notifications_first_not_suppressed check (not (is_first and suppressed_reason is not null))
);
create unique index employer_applicant_notifications_first_per_job on public.employer_applicant_notifications (job_posting_id) where is_first;
create index employer_applicant_notifications_digest_due_idx on public.employer_applicant_notifications (created_at) where digested_at is null and suppressed_reason is null;
create index employer_applicant_notifications_org_idx on public.employer_applicant_notifications (organization_id, created_at desc);

alter table public.employer_applicant_notifications enable row level security;
revoke all on table public.employer_applicant_notifications from public, anon, authenticated;

alter table public.email_preferences
  add column new_applicant_notice text not null default 'instant' check (new_applicant_notice in ('instant', 'digest', 'off'));
comment on column public.email_preferences.new_applicant_notice is
  '0254: how this person wants to hear about new applicants on their organisation''s jobs: instant (the first applicant of a job at once, the rest in the daily digest), digest (digest only), off. Service role only.';

create or replace function public.record_new_applicant_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_org uuid;
  v_src public.job_source_type;
  v_qa boolean;
begin
  select j.organization_id, j.source_type into v_org, v_src from public.job_postings j where j.id = new.job_posting_id;
  if v_org is null or v_src is distinct from 'internal'::public.job_source_type then
    return new;
  end if;
  select coalesce(public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name), false) into v_qa from public.profiles p where p.id = new.user_id;
  if coalesce(v_qa, false) then
    insert into public.employer_applicant_notifications (application_id, job_posting_id, organization_id, is_first, suppressed_reason)
    values (new.id, new.job_posting_id, v_org, false, 'qa_applicant')
    on conflict (application_id) do nothing;
    return new;
  end if;
  begin
    insert into public.employer_applicant_notifications (application_id, job_posting_id, organization_id, is_first)
    values (new.id, new.job_posting_id, v_org, true)
    on conflict (application_id) do nothing;
  exception when unique_violation then
    -- somebody else is already this job's first applicant: record this one for the digest
    insert into public.employer_applicant_notifications (application_id, job_posting_id, organization_id, is_first)
    values (new.id, new.job_posting_id, v_org, false)
    on conflict (application_id) do nothing;
  end;
  return new;
exception when others then
  raise warning '0254: record_new_applicant_notification failed for application %: %', new.id, sqlerrm;
  return new;
end
$f$;
revoke all on function public.record_new_applicant_notification() from public, anon, authenticated;

create trigger applications_new_applicant_on_insert
  after insert on public.applications
  for each row when (new.stage = 'applied'::public.application_stage and new.job_posting_id is not null)
  execute function public.record_new_applicant_notification();
create trigger applications_new_applicant_on_stage
  after update of stage on public.applications
  for each row when (new.stage = 'applied'::public.application_stage and old.stage is distinct from new.stage and new.job_posting_id is not null)
  execute function public.record_new_applicant_notification();

-- The instant email: claimed exactly once, released if the send failed (then the row simply appears in the next digest).
create or replace function public.claim_applicant_instant(p_application uuid)
returns table (job_posting_id uuid, organization_id uuid)
language sql
security definer
set search_path = ''
as $f$
  update public.employer_applicant_notifications n
     set instant_sent_at = pg_catalog.now()
   where n.application_id = p_application and n.is_first and n.suppressed_reason is null and n.instant_sent_at is null
  returning n.job_posting_id, n.organization_id;
$f$;
revoke all on function public.claim_applicant_instant(uuid) from public, anon, authenticated;
grant execute on function public.claim_applicant_instant(uuid) to service_role;

create or replace function public.release_applicant_instant(p_application uuid)
returns boolean
language sql
security definer
set search_path = ''
as $f$
  with r as (update public.employer_applicant_notifications set instant_sent_at = null where application_id = p_application and instant_sent_at is not null returning 1)
  select exists (select 1 from r);
$f$;
revoke all on function public.release_applicant_instant(uuid) from public, anon, authenticated;
grant execute on function public.release_applicant_instant(uuid) to service_role;

-- The digest: a batch of unsent, non-suppressed notifications older than p_until, claimed exactly once (skip locked). already_announced = the instant email for this one has gone out.
create or replace function public.claim_applicant_digest(p_until timestamptz, p_limit integer default 500)
returns table (notification_id uuid, application_id uuid, job_posting_id uuid, organization_id uuid, is_first boolean, already_announced boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $f$
begin
  return query
    with due as (
      select n.id from public.employer_applicant_notifications n
       where n.digested_at is null and n.suppressed_reason is null and n.created_at < p_until
       order by n.created_at, n.id
       limit greatest(1, least(coalesce(p_limit, 500), 5000))
       for update skip locked
    ), u as (
      update public.employer_applicant_notifications n set digested_at = pg_catalog.now()
        from due where n.id = due.id
      returning n.id, n.application_id, n.job_posting_id, n.organization_id, n.is_first, n.instant_sent_at, n.created_at
    )
    select u.id, u.application_id, u.job_posting_id, u.organization_id, u.is_first, (u.is_first and u.instant_sent_at is not null), u.created_at from u order by u.created_at, u.id;
end
$f$;
revoke all on function public.claim_applicant_digest(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.claim_applicant_digest(timestamptz, integer) to service_role;

create or replace function public.release_applicant_digest(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_n integer;
begin
  update public.employer_applicant_notifications set digested_at = null where id = any (p_ids) and digested_at is not null;
  get diagnostics v_n = row_count;
  return v_n;
end
$f$;
revoke all on function public.release_applicant_digest(uuid[]) from public, anon, authenticated;
grant execute on function public.release_applicant_digest(uuid[]) to service_role;

-- Who may be emailed for an organisation (members; not scheduled for deletion; an email; setting not 'off'; not a QA account).
create or replace function public.new_applicant_recipients(p_organization uuid)
returns table (user_id uuid, email text, first_name text, mode text)
language sql
stable
security definer
set search_path = ''
as $f$
  select p.id, p.email, p.first_name, coalesce(ep.new_applicant_notice, 'instant')
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    left join public.email_preferences ep on ep.user_id = p.id
   where m.organization_id = p_organization
     and p.deletion_requested_at is null
     and p.email is not null and pg_catalog.btrim(p.email) <> ''
     and coalesce(ep.new_applicant_notice, 'instant') <> 'off'
     and not coalesce(public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name), false)
   order by p.id;
$f$;
revoke all on function public.new_applicant_recipients(uuid) from public, anon, authenticated;
grant execute on function public.new_applicant_recipients(uuid) to service_role;

-- Self-check: the migration fails (and nothing is kept) unless access is exactly as designed and the functions actually run.
do $check$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.employer_applicant_notifications'::regclass) then raise exception '0254: row level security is off'; end if;
  if has_table_privilege('anon', 'public.employer_applicant_notifications', 'SELECT, INSERT, UPDATE, DELETE') or has_table_privilege('authenticated', 'public.employer_applicant_notifications', 'SELECT, INSERT, UPDATE, DELETE')
     or has_any_column_privilege('anon', 'public.employer_applicant_notifications', 'SELECT, INSERT, UPDATE') or has_any_column_privilege('authenticated', 'public.employer_applicant_notifications', 'SELECT, INSERT, UPDATE') then
    raise exception '0254: a client role holds a privilege on employer_applicant_notifications';
  end if;
  if not has_table_privilege('service_role', 'public.employer_applicant_notifications', 'SELECT, INSERT, UPDATE, DELETE') then raise exception '0254: service_role lost access'; end if;
  if has_column_privilege('anon', 'public.email_preferences', 'new_applicant_notice', 'SELECT, UPDATE') or has_column_privilege('authenticated', 'public.email_preferences', 'new_applicant_notice', 'SELECT, UPDATE') then
    raise exception '0254: a client role can read or write email_preferences.new_applicant_notice';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'employer_applicant_notifications_first_per_job' and indexdef like '%UNIQUE%' and indexdef like '%is_first%') then raise exception '0254: the first-applicant-per-job key is missing'; end if;
  if (select count(*) from pg_constraint where conrelid = 'public.employer_applicant_notifications'::regclass and contype = 'u' and pg_get_constraintdef(oid) = 'UNIQUE (application_id)') <> 1 then raise exception '0254: the one-per-application key is missing'; end if;
  if (select count(*) from pg_trigger where tgname in ('applications_new_applicant_on_insert', 'applications_new_applicant_on_stage') and not tgisinternal) <> 2 then raise exception '0254: the two triggers are not both there'; end if;
  if (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('record_new_applicant_notification', 'claim_applicant_instant', 'release_applicant_instant', 'claim_applicant_digest', 'release_applicant_digest', 'new_applicant_recipients')
        and p.prosecdef and p.proconfig = array['search_path=""']) <> 6 then
    raise exception '0254: the six functions must be SECURITY DEFINER with an empty search_path';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('record_new_applicant_notification', 'claim_applicant_instant', 'release_applicant_instant', 'claim_applicant_digest', 'release_applicant_digest', 'new_applicant_recipients')
        and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
    raise exception '0254: no client role may execute any of the functions';
  end if;
  -- Smoke: call the read paths with random ids so a typo in a body cannot hide until production.
  if exists (select 1 from public.claim_applicant_instant(gen_random_uuid())) then raise exception '0254: claim_applicant_instant does not run'; end if;
  if exists (select 1 from public.new_applicant_recipients(gen_random_uuid())) then raise exception '0254: new_applicant_recipients does not run'; end if;
  if public.release_applicant_instant(gen_random_uuid()) is distinct from false then raise exception '0254: release_applicant_instant does not run'; end if;
  if public.release_applicant_digest(array[gen_random_uuid()]) is distinct from 0 then raise exception '0254: release_applicant_digest does not run'; end if;
end
$check$;
