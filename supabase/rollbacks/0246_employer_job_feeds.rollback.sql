-- Rollback of 0246 (employer job feeds). Refuses to run while any imported posting exists: dropping import_feed_id would turn imported, link-out postings into ordinary internal postings.
begin;
set local lock_timeout = '3s';

do $guard$
begin
  if exists (select 1 from public.job_postings where import_feed_id is not null) then
    raise exception '0246 rollback refused: imported postings exist (close and delete them first)';
  end if;
end
$guard$;

-- 0237's definition of the widget read, restored.
create or replace function public.org_job_widget(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $f$
declare
  v_name text;
  v_logo text;
  v_max  integer;
  v_jobs jsonb;
begin
  -- Every gate on the organisation, stated here because a DEFINER function does not inherit row level security.
  select o.name, o.logo_url, w.max_items
    into v_name, v_logo, v_max
    from public.organizations o
    join public.employer_widgets w on w.organization_id = o.id
    left join public.profiles c on c.id = o.created_by
   where o.id = p_org_id
     and o.verified
     and w.enabled
     and not public.is_qa_account(c.email, c.first_name, c.last_name, c.referral_leaderboard_display_name);
  if not found then
    return null;
  end if;

  -- Every gate on the postings. The explicit key list below is the whole output: nothing else can be added by accident.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', x.id,
             'title', x.title,
             'location', x.location,
             'work_type', x.work_type::text,
             'employment_type', x.employment_type::text,
             'posted_at', x.posted_at
           ) order by x.posted_at desc, x.id desc
         ), '[]'::jsonb)
    into v_jobs
    from (
      select j.id, j.title, j.location, j.work_type, j.employment_type, j.posted_at
        from public.job_postings j
       where j.organization_id = p_org_id
         and j.source_type = 'internal'
         and j.status = 'open'
         and j.removed_at is null
         and j.unlisted_at is null
         and j.superseded_at is null
         and (j.expires_at is null or j.expires_at > now())
       order by j.posted_at desc, j.id desc
       limit v_max
    ) x;

  return jsonb_build_object(
    'org', jsonb_build_object('name', v_name, 'logo_url', v_logo),
    'jobs', v_jobs
  );
end
$f$;

revoke execute on function public.org_job_widget(uuid) from public, anon, authenticated;
grant execute on function public.org_job_widget(uuid) to service_role;
comment on function public.org_job_widget(uuid) is
  '0237: the public job-list widget''s one read. Returns NULL unless the organisation is verified, has its widget enabled and was not created by a QA account; otherwise {org:{name,logo_url}, jobs:[{id,title,location,work_type,employment_type,posted_at}]} for its open, listed, internal postings, newest first, at most max_items. service_role only.';

-- 0221's INSERT policy expression, restored (before the columns it names are dropped).
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
  );

-- 0190's UPDATE policy, restored exactly (before the column it names is dropped).
alter policy "org members can update their org's internal postings" on public.job_postings
  using (
    source_type = 'internal'::public.job_source_type
    and public.is_org_member(organization_id)
    and status <> 'removed'::public.job_status
  )
  with check (
    source_type = 'internal'::public.job_source_type
    and public.is_org_member(organization_id)
    and status in ('open'::public.job_status, 'closed'::public.job_status, 'draft'::public.job_status)
  );

drop function if exists public.prune_employer_job_feed_attempts(interval);
drop index if exists public.job_postings_import_feed_idx;
drop index if exists public.job_postings_import_unique;
alter table public.job_postings drop constraint if exists job_postings_import_is_internal;
alter table public.job_postings drop constraint if exists job_postings_import_pair;
alter table public.job_postings drop column if exists employer_closed_at;
alter table public.job_postings drop column if exists import_key;
alter table public.job_postings drop column if exists import_feed_id;

drop table if exists public.employer_job_feed_attempts;
drop trigger if exists employer_job_feeds_touch_updated_at on public.employer_job_feeds;
drop table if exists public.employer_job_feeds;
drop function if exists public.employer_job_feeds_touch_updated_at();

commit;
