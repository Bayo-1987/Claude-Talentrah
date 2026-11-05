-- 0275 (PR-E2a, the database half of "an employer chooses to receive resumes by email"; plan: reports/S1/apply-email-e2-plan-v2.md; number 0275 stated by the owner on 4 Nov 2026).
--
-- WHAT IT DOES, in this order:
--   1. CLOSES THE INSERT GAP left open by 0274. authenticated holds a TABLE-level INSERT on job_postings (0177, 0246), so a column grant cannot stop a member setting apply_email when they
--      create a posting. The INSERT policy "org members can manage their org's internal postings" gets one more condition, apply_email is null (the 0246 expression otherwise unchanged).
--      UPDATE needs no change: it is revoked at table level (0056) and no column grant covers apply_email.
--   2. job_posting_apply_email_events: the audit trail. One row per real change (who, which job, from what, to what, when). No API role can read or write it; only the function below appends.
--      The job id has NO foreign key on purpose, so a deleted job keeps its trail; the actor is set null if the account is deleted (the 0064 rule).
--   3. set_job_apply_email(p_job_id, p_address): the ONLY way an address is set, changed or cleared (null clears). SECURITY DEFINER, executable by authenticated only. Any member of the job's
--      organisation may call it: the repo has an owner/admin role (org_member_role) but nothing that posts a job compares it, and posting itself is "any member" (is_org_member in the RLS policies),
--      so this follows posting. It takes the job row lock first (FOR UPDATE) and then checks and acts in one transaction (the repo's rule for anything that gates on a counted value):
--        - the job must be internal, not imported, not removed, and draft, open or closed;
--        - the address must be one plain lower-case ASCII address, the same allowlist as src/lib/jobs/apply-email.ts (the function refuses, it never trims or lower-cases: the app does that);
--        - switching a job TO email (no address yet) is refused while any application with source internal_apply or auto_apply exists. A manual row (a seeker's own tracker entry) does not count.
--          Clearing is never refused. FOR UPDATE conflicts with the FOR KEY SHARE lock an application insert takes on the job row, so an application already being written either finishes first
--          (and is counted) or waits until this transaction ends;
--        - at most 5 changes per job per rolling 24 hours, counted from the audit table inside the lock;
--        - an unchanged value returns at once: no audit row, no count.
--      Each refusal has its own SQLSTATE so the screen can show the plain sentence: AE001 applications exist, AE002 the cap, AE003 the address, AE004 the job cannot change; 42501 not your job; 28000 not signed in.
--
-- WHAT IT DOES NOT DO. It does not touch promoted_jobs (the promoted strip only reorders rows the feed already loaded with apply_email), adds no company-link choice, no screen and no action: nothing
-- calls the function until PR-E2b. Applying it changes no page. The one visible effect is that a member can no longer INSERT a posting that carries an address.
--
-- PREFLIGHT PINS for the package S3-21 runs (hash-pinned). The live INSERT policy's WITH CHECK is read with
--   select pg_get_expr(polwithcheck, polrelid) from pg_policy where polrelid = 'public.job_postings'::regclass and polname = 'org members can manage their org''s internal postings'
-- BEFORE this migration it must be 464 characters long with md5 af80642dd9f038db9a810f4d072f167c (read on talentrah-preview; production is unread: the package reads it and STOPS if it differs).
-- AFTER it, it must be 490 characters long with md5 b5d4e35d0346ce4e3ec126aa37cda56c (the old expression plus " AND (apply_email IS NULL)"). tests/supabase/migration-0275-shape.test.ts rebuilds both
-- expressions from the SQL text in this file and its rollback and checks the pins, so they cannot drift from the file.
--
-- ORDER. Additive, so it is applied to preview and then production BEFORE PR-E2b merges. The exact undo is supabase/rollbacks/0275_job_postings_apply_email_write.rollback.sql (revert PR-E2b first;
-- it refuses to run while any audit row exists).

-- Fail fast instead of queueing behind a long query on job_postings: the migration is retried, not waited for.
set local lock_timeout = '3s';

-- 1. The INSERT policy: the 0246 expression plus apply_email is null --------------------------------------------------------------------------------
alter policy "org members can manage their org's internal postings" on public.job_postings
  with check (
    source_type = 'internal'::public.job_source_type
    and public.is_org_member(organization_id)
    and unlisted_at is null
    and removed_at is null
    and removal_reason is null
    and removed_by is null
    and admin_review_decision is null
    and admin_reviewed_at is null
    and admin_reviewed_by is null
    and banner_path is null
    and claimed_by_organization_id is null
    and claimed_at is null
    and import_feed_id is null
    and import_key is null
    and employer_closed_at is null
    and apply_email is null
  );

-- 2. The audit trail -----------------------------------------------------------------------------------------------------------------------------
create table public.job_posting_apply_email_events (
  id              uuid primary key default gen_random_uuid(),
  job_posting_id  uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id   uuid references public.profiles (id) on delete set null,
  old_address     text,
  new_address     text,
  created_at      timestamptz not null default now(),
  check (char_length(old_address) <= 254),
  check (char_length(new_address) <= 254),
  check (old_address is distinct from new_address)
);

comment on table public.job_posting_apply_email_events is
  '0275: one row per real change of job_postings.apply_email (set, change, clear): who, which job, from what, to what. Written only by set_job_apply_email; no API role can read or write it. job_posting_id has no foreign key so a deleted job keeps its trail.';

create index job_posting_apply_email_events_job_idx on public.job_posting_apply_email_events (job_posting_id, created_at desc);

alter table public.job_posting_apply_email_events enable row level security;
revoke all on table public.job_posting_apply_email_events from public, anon, authenticated, service_role;
grant select, insert on table public.job_posting_apply_email_events to service_role;

-- 3. The only write path ---------------------------------------------------------------------------------------------------------------------------
create or replace function public.set_job_apply_email(p_job_id uuid, p_address text)
returns void
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_actor   uuid := (select auth.uid());
  v_job     record;
  v_old     text;
  v_changes integer;
begin
  if v_actor is null then
    raise exception 'Sign in to change how people apply.' using errcode = '28000';
  end if;

  -- The row lock comes first: every check below reads state that another change to this job could be moving.
  select j.id, j.organization_id, j.source_type, j.import_feed_id, j.status, j.removed_at, j.apply_email
    into v_job
    from public.job_postings j
   where j.id = p_job_id
     for update;

  -- One answer for "no such job" and "not your job".
  if not found or v_job.organization_id is null or not public.is_org_member(v_job.organization_id) then
    raise exception 'That job was not found.' using errcode = '42501';
  end if;

  if v_job.source_type <> 'internal'::public.job_source_type
     or v_job.import_feed_id is not null
     or v_job.removed_at is not null
     or v_job.status not in ('draft'::public.job_status, 'open'::public.job_status, 'closed'::public.job_status) then
    raise exception 'This job''s apply method can''t be changed.' using errcode = 'AE004';
  end if;

  if p_address is not null then
    -- The same allowlist as src/lib/jobs/apply-email.ts, on an already trimmed, lower-cased value: refused, never repaired.
    if char_length(p_address) > 254
       or p_address !~ '^[a-z0-9._+-]{1,64}@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$'
       or p_address ~ '(^\.|\.@|\.\.)' then
      raise exception 'Enter one email address, such as careers@yourcompany.com.' using errcode = 'AE003';
    end if;
  end if;

  v_old := v_job.apply_email;

  -- Nothing changes: no audit row and no use of the cap.
  if p_address is not distinct from v_old then
    return;
  end if;

  if p_address is not null and v_old is null and exists (
       select 1 from public.applications a
        where a.job_posting_id = p_job_id
          and a.source in ('internal_apply'::public.application_source, 'auto_apply'::public.application_source)
     ) then
    raise exception 'This job already has applications on Talentrah, so it can''t be switched to email. Close it and post a new job instead.' using errcode = 'AE001';
  end if;

  select count(*) into v_changes
    from public.job_posting_apply_email_events e
   where e.job_posting_id = p_job_id
     and e.created_at > pg_catalog.now() - interval '24 hours';
  if v_changes >= 5 then
    raise exception 'This job''s apply method was changed 5 times in the last 24 hours. Try again tomorrow.' using errcode = 'AE002';
  end if;

  update public.job_postings set apply_email = p_address where id = p_job_id;

  insert into public.job_posting_apply_email_events (job_posting_id, organization_id, actor_user_id, old_address, new_address)
  values (p_job_id, v_job.organization_id, v_actor, v_old, p_address);
end
$f$;

revoke all on function public.set_job_apply_email(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_job_apply_email(uuid, text) to authenticated;

comment on function public.set_job_apply_email(uuid, text) is
  '0275: the only way job_postings.apply_email is set, changed or cleared (null clears). Any member of the job''s organisation; one locked check-and-act; refuses a switch to email once an internal_apply or auto_apply application exists; at most 5 changes per job per 24 hours; writes the audit row. authenticated only.';

-- Guard: the policy, the function and the audit table are what they must be, and the column still cannot be updated by a client ----------------------
do $guard$
declare
  v_check text;
begin
  select pg_get_expr(p.polwithcheck, p.polrelid) into v_check
    from pg_policy p
   where p.polrelid = 'public.job_postings'::regclass
     and p.polname = 'org members can manage their org''s internal postings'
     and p.polcmd = 'a';
  if v_check is null then
    raise exception '0275: the job_postings INSERT policy was not found';
  end if;
  if position('(apply_email IS NULL)' in v_check) = 0 then
    raise exception '0275: the INSERT policy does not require apply_email to be null';
  end if;
  if (length(v_check) - length(replace(v_check, 'IS NULL', ''))) / 7 <> 14 then
    raise exception '0275: the INSERT policy must carry exactly 14 null conditions (found %)', (length(v_check) - length(replace(v_check, 'IS NULL', ''))) / 7;
  end if;

  if not exists (select 1 from pg_proc p where p.oid = 'public.set_job_apply_email(uuid, text)'::regprocedure and p.prosecdef) then
    raise exception '0275: set_job_apply_email is not SECURITY DEFINER';
  end if;
  if has_function_privilege('anon', 'public.set_job_apply_email(uuid, text)', 'execute') then
    raise exception '0275: set_job_apply_email is executable by anon';
  end if;
  if exists (
       select 1 from pg_proc p
        where p.oid = 'public.set_job_apply_email(uuid, text)'::regprocedure
          and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
     ) then
    raise exception '0275: set_job_apply_email is executable by PUBLIC';
  end if;
  if not has_function_privilege('authenticated', 'public.set_job_apply_email(uuid, text)', 'execute') then
    raise exception '0275: set_job_apply_email is not executable by authenticated';
  end if;

  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.job_posting_apply_email_events'::regclass) then
    raise exception '0275: job_posting_apply_email_events has no row level security';
  end if;
  if has_table_privilege('anon', 'public.job_posting_apply_email_events', 'SELECT, INSERT, UPDATE, DELETE')
     or has_table_privilege('authenticated', 'public.job_posting_apply_email_events', 'SELECT, INSERT, UPDATE, DELETE')
     or has_any_column_privilege('anon', 'public.job_posting_apply_email_events', 'SELECT')
     or has_any_column_privilege('authenticated', 'public.job_posting_apply_email_events', 'SELECT')
     or has_any_column_privilege('authenticated', 'public.job_posting_apply_email_events', 'INSERT')
     or has_any_column_privilege('authenticated', 'public.job_posting_apply_email_events', 'UPDATE') then
    raise exception '0275: job_posting_apply_email_events is reachable by an API role';
  end if;
  if not has_table_privilege('service_role', 'public.job_posting_apply_email_events', 'SELECT')
     or not has_table_privilege('service_role', 'public.job_posting_apply_email_events', 'INSERT') then
    raise exception '0275: service_role must be able to read and append job_posting_apply_email_events';
  end if;

  if has_column_privilege('anon', 'public.job_postings', 'apply_email', 'UPDATE')
     or has_column_privilege('authenticated', 'public.job_postings', 'apply_email', 'UPDATE') then
    raise exception '0275: no client may UPDATE job_postings.apply_email';
  end if;
end
$guard$;
