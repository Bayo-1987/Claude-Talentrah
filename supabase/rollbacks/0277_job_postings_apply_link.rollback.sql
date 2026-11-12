begin;
set local lock_timeout = '3s';

-- Rollback of 0277 (the career-site link). It refuses to run while any job holds a link or any link audit row exists: dropping the columns would silently turn those jobs back into in-app jobs, and
-- dropping the table would erase the record of who set which link. Clear the links through the app (or archive the audit rows), then run it. Revert the app commit first: nothing may still call
-- the new functions. It does not touch job_postings.apply_email (0274 owns that column).
do $guard$
begin
  if exists (select 1 from public.job_postings where apply_link is not null) then
    raise exception '0277 rollback refused: jobs hold a career-site link (clear them first)';
  end if;
  if exists (select 1 from public.job_posting_apply_link_events) then
    raise exception '0277 rollback refused: job_posting_apply_link_events holds rows (archive them first)';
  end if;
end
$guard$;

-- 0275's set_job_apply_email, restored VERBATIM (tests/supabase/migration-0277-shape.test.ts compares it with the text of 0275; the package compares md5(pg_get_functiondef) with the value it recorded before 0277).
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

-- 0275's INSERT policy expression, restored: 490 characters as Postgres deparses it, md5 b5d4e35d0346ce4e3ec126aa37cda56c.
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

drop function if exists public.set_job_apply_link(uuid, uuid, text, text, boolean);
drop function if exists public.get_job_apply_link(uuid);
drop function if exists public.record_apply_link_click(uuid);
drop table if exists public.apply_link_clicks;
drop table if exists public.job_posting_apply_link_events;

alter table public.job_postings drop constraint if exists job_postings_one_off_platform_method;
alter table public.job_postings drop constraint if exists job_postings_apply_link_all_or_none;
alter table public.job_postings drop constraint if exists job_postings_apply_link_kind_known;
alter table public.job_postings drop constraint if exists job_postings_apply_link_host_length;
alter table public.job_postings drop constraint if exists job_postings_apply_link_length;
alter table public.job_postings drop column if exists apply_link_host;
alter table public.job_postings drop column if exists apply_link_kind;
alter table public.job_postings drop column if exists apply_link;

commit;
