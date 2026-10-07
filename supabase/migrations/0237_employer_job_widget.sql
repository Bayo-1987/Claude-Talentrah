-- 0237: the employer job-list widget, database part: the per-organisation switch (employer_widgets), the one read function the public /embed route calls (org_job_widget), and the index that read uses.
--
-- WHAT THE PRODUCT IS (owner decision 7 Oct 2026, plan v2.1 in reports/S1): an employer can show its OWN open postings on its own website in an iframe. The page it frames is a public route of this app that reads
-- through the service role and calls the one function below. Public job fields only, never applicant data; every job links to its Talentrah page. The switch is OFF by default and the employer turns it on.
--
-- WHAT THIS ADDS (additive only; no existing table, policy, grant or function changes):
--   1. public.employer_widgets: one row per organisation (organization_id is the primary key and cascades on delete): enabled (default false), max_items (1 to 20, default 10), created_at, updated_at.
--      Row level security: members of that organisation may read, create and change their own row; nobody else, and anon never. COLUMN grants, not just policies (CLAUDE.md: a row policy does not restrict columns):
--      authenticated may SELECT every column, INSERT (organization_id, enabled, max_items) and UPDATE (enabled, max_items) only; nobody may DELETE (the row goes only when its organisation does). The timestamps are
--      not client-writable: created_at defaults, and a small BEFORE UPDATE trigger stamps updated_at.
--   2. public.org_job_widget(p_org_id uuid) returns jsonb: SECURITY DEFINER, search_path = public, pg_temp, EXECUTE for service_role only (the route calls it with the service-role client; anon and authenticated cannot).
--      A SECURITY DEFINER function does not run row level security (0109 is the lesson: a DEFINER read of job_postings that did not state the verified gate returned an unverified organisation's postings), so EVERY gate is
--      written out here, and a test asserts it returns the same posting set as the public feed would for the organisation:
--        the organisation exists, is VERIFIED, has its widget row with enabled = true, and was not created by a QA account (public.is_qa_account on the creator's profile, 0240);
--        a posting is shown only if it is internal, status = 'open', not removed, not unlisted (unlisted_at is null: link-only postings never appear in a list), not superseded, and within its closing date
--        (expires_at is null or in the future: the expiry sweep closes expired postings, this does not wait for it).
--      Any failed gate, and an unknown organisation, returns NULL, so the route can show one neutral page for every cause and reveal nothing about which organisations exist. An enabled organisation with no open postings
--      returns its name and logo with an empty list.
--      The result has EXACTLY these keys and no others, so no applicant, application, salary, description or internal field can ever appear in it:
--        {"org": {"name", "logo_url"}, "jobs": [{"id", "title", "location", "work_type", "employment_type", "posted_at"}]}   (newest first, at most max_items)
--   3. A partial index for that read: job_postings (organization_id, posted_at desc) where status = 'open' and source_type = 'internal'.
--
-- WHAT IT DOES NOT DO. No trigger on job_postings, no outbox table, no poller (the route is cached and revalidated by TypeScript hooks at the sites that change a posting; a poller would be a new cron).
-- Changes made inside SQL with no TypeScript caller in the path (account deletion, supersession, an organisation rename trigger) show up at the next cache expiry; that gap is stated in the plan, not hidden here.
--
-- PER-REQUEST COST. Server work per request: the public route is cached, so a visitor's page view costs the origin nothing; a cache MISS is one call to org_job_widget: one primary-key read of employer_widgets and
-- organizations (plus the creator's profile row), and one index-ordered read of at most 20 job_postings rows through the partial index above. No loop, no per-row call.
--
-- ORDER. Additive: apply to preview, then production (the owner's chain: it reads personal data), BEFORE the code that calls it merges. The exact undo is supabase/rollbacks/0237_employer_job_widget.rollback.sql.

-- 1. The switch --------------------------------------------------------------------------------------------------------------------------------
create table public.employer_widgets (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  enabled         boolean not null default false,
  max_items       integer not null default 10 check (max_items between 1 and 20),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.employer_widgets is
  '0237: one row per organisation that has configured its job-list widget (iframe). enabled defaults to false. Members of the organisation read and change their own row; the public embed route reads it only through org_job_widget (service role).';

alter table public.employer_widgets enable row level security;

-- Column grants first: nothing by default, then exactly what an organisation member may do. (A table-level grant would override the column list, so there is none.)
revoke all on table public.employer_widgets from public, anon, authenticated;
grant select (organization_id, enabled, max_items, created_at, updated_at) on public.employer_widgets to authenticated;
grant insert (organization_id, enabled, max_items) on public.employer_widgets to authenticated;
grant update (enabled, max_items) on public.employer_widgets to authenticated;

create policy "members read their organisation's widget settings"
  on public.employer_widgets for select to authenticated
  using (public.is_org_member(organization_id));

create policy "members create their organisation's widget settings"
  on public.employer_widgets for insert to authenticated
  with check (public.is_org_member(organization_id));

create policy "members change their organisation's widget settings"
  on public.employer_widgets for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create or replace function public.employer_widgets_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $t$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$t$;
-- A trigger function: nobody calls it directly and a trigger does not check the caller's EXECUTE (0213), so no client role keeps it.
revoke execute on function public.employer_widgets_touch_updated_at() from public, anon, authenticated;

create trigger employer_widgets_touch_updated_at
  before update on public.employer_widgets
  for each row execute function public.employer_widgets_touch_updated_at();

-- 2. The one read ------------------------------------------------------------------------------------------------------------------------------
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

-- 3. The index that read uses ------------------------------------------------------------------------------------------------------------------
create index if not exists job_postings_org_open_internal_posted_idx
  on public.job_postings (organization_id, posted_at desc)
  where status = 'open' and source_type = 'internal';
