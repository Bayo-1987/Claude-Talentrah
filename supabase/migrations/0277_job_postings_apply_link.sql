-- 0277 (PR-E4, gate 1: the database half of "an employer chooses a third way to take applications: On our career site"; decision OWNER-DECISION-EMPLOYER-APPLY-LINK-1; Step 0 approved by the Reviewer).
--
-- WHAT IT DOES, in this order:
--   1. Three columns on job_postings, set ONLY by set_job_apply_link: apply_link (the employer's career-page address), apply_link_kind ('company' = on the verified company's own domain,
--      'ats' = an allowlisted applicant-tracking host the employer confirmed is their own page) and apply_link_host (the host alone, so a page, a card or structured data can say "Opens {host}"
--      without ever loading the address). CHECKs: kind, host and link are all set or all null; the link is at most 2000 characters (the sheet importer's own cap, kept); and an apply_email and an
--      apply_link are never both set (one method per job). They are added NOT VALID and validated afterwards, so the table is not held under a long lock.
--      job_postings.external_url is NOT reused: the stale sweep, claim, freshness, the tracker snapshot and the Auto-Apply hand-off all read it, and imported rows keep today's behaviour exactly.
--   2. Grants. anon and authenticated can read apply_link_kind and apply_link_host (they hold no secret: the host is what the button says). NOBODY with an API role can read apply_link: the
--      redirect route reads it with the service role and re-checks it, and the employer's edit screen gets its own address back through get_job_apply_link, which checks membership.
--      No UPDATE grant exists for any of the three (UPDATE is revoked at table level, 0056).
--   3. The INSERT policy "org members can manage their org's internal postings" gets three more conditions: apply_link, apply_link_kind and apply_link_host are null. authenticated holds a TABLE-level
--      INSERT on job_postings, so the policy's WITH CHECK is the only thing that stops a member creating a row that already carries a link (the same reason as 0246 and 0275).
--   4. job_posting_apply_link_events (the audit trail: who, which job, from what, to what, whether the employer ticked "this is our own careers page", and the address a link replaced), no API
--      access, the job id has NO foreign key so a deleted job keeps its trail; and apply_link_clicks (a counter per job per UTC day: no user id of any kind).
--   5. set_job_apply_link(p_job_id, p_actor, p_url, p_kind, p_ats_confirmed): the ONLY write path for a link. SERVICE ROLE ONLY: authenticated and anon have no EXECUTE, so a direct call from a
--      browser or a script with a user token is refused by privilege. The Server Action runs the full validator (src/lib/jobs/apply-link.ts) and calls it with the signed-in user as p_actor. Inside,
--      under the job row lock, SQL re-checks: the actor is a member of the job's organisation; the job is an internal, non-imported, non-removed draft, open or closed job; the link's shape (https,
--      at most 2000 characters, no whitespace, a lower-case ASCII host with at least one dot, no user info, no port); BOTH domain paths (kind 'company' needs a verified organisation and the host to
--      be the organisation's domain or a dot-boundary subdomain of it; kind 'ats' needs an allowlisted host, a company page path where the host is path-style, and the confirmation tick); the
--      has-applications lock; and the shared cap. Shorteners, IP hosts and job-board hosts stay in the TypeScript validator only: only the Server Action can reach this function.
--      Errors: 28000 not signed in, 42501 not found or not yours, AE004 not changeable, AE005 the link is refused, AE006 a link on the company's own domain needs a verified company, AE007 the careers
--      page confirmation is missing, AE001 the job already has applications, AE002 more than 5 changes in 24 hours.
--   6. get_job_apply_link(p_job_id): returns the stored address to a member of the job's organisation and null to everyone else. authenticated only.
--   7. record_apply_link_click(p_job_id): increments the day's counter. Service role only; best-effort by design.
--   8. set_job_apply_email REPLACED (create or replace; same signature, same grants, the AE001..AE004 contract unchanged): setting an address now also clears a link in the same transaction (with an
--      audit row marked replaced_by_email), and the cap counts email changes and link changes together (a replacement is one change, counted once). With no link on the job it behaves as before.
--
-- ONE CAP, COUNTED ONCE. The cap is 5 changes per job per 24 hours across both methods: rows of job_posting_apply_email_events plus rows of job_posting_apply_link_events that are not replaced_by_email.
-- Switching from a link to an email writes an email event and a replaced_by_email link event (counted once); switching from an email to a link writes ONE link event whose replaced_email names the
-- address it cleared (counted once).
--
-- PREFLIGHT PINS for the package S3-21 runs (hash-pinned; the package READS and STOPS if a pin differs, on BOTH projects):
--   select pg_get_expr(polwithcheck, polrelid) from pg_policy where polrelid = 'public.job_postings'::regclass and polname = 'org members can manage their org''s internal postings'
--   BEFORE this migration it must be 490 characters long with md5 b5d4e35d0346ce4e3ec126aa37cda56c (the 0275 expression).
--   AFTER it, it must be 575 characters long with md5 4a86f3501566ff9d0284d8c5a448a4a1 (that expression plus the three conditions of step 3).
--   Also record md5(pg_get_functiondef('public.set_job_apply_email(uuid, text)'::regprocedure)) BEFORE; the rollback restores that function exactly and the package compares the md5 after a rollback.
-- tests/supabase/migration-0277-shape.test.ts rebuilds both expressions from the SQL text of this file and of the rollback, and checks that the rollback's function is the 0275 function verbatim.
--
-- WHAT IT DOES NOT DO. No screen, action, route or button: nothing calls any of this until the app commit (gate 2). Applying it changes no page. The one visible effect is that a member can no
-- longer INSERT a posting that carries a link. promoted_jobs is not touched. The importer is not touched.
--
-- ORDER. Additive, so it is applied to preview and then production BEFORE the app commit merges. The exact undo is supabase/rollbacks/0277_job_postings_apply_link.rollback.sql (it refuses while any
-- job holds a link or any link audit row exists).

-- Fail fast instead of queueing behind a long query on job_postings: the migration is retried, not waited for.
set local lock_timeout = '3s';

-- 1. The columns ---------------------------------------------------------------------------------------------------------------------------------
alter table public.job_postings
  add column if not exists apply_link      text,
  add column if not exists apply_link_kind text,
  add column if not exists apply_link_host text;

alter table public.job_postings
  add constraint job_postings_apply_link_length      check (char_length(apply_link) <= 2000) not valid,
  add constraint job_postings_apply_link_host_length check (char_length(apply_link_host) <= 253) not valid,
  add constraint job_postings_apply_link_kind_known  check (apply_link_kind in ('company', 'ats')) not valid,
  add constraint job_postings_apply_link_all_or_none check ((apply_link is null) = (apply_link_kind is null) and (apply_link is null) = (apply_link_host is null)) not valid,
  add constraint job_postings_one_off_platform_method check (apply_email is null or apply_link is null) not valid;

alter table public.job_postings validate constraint job_postings_apply_link_length;
alter table public.job_postings validate constraint job_postings_apply_link_host_length;
alter table public.job_postings validate constraint job_postings_apply_link_kind_known;
alter table public.job_postings validate constraint job_postings_apply_link_all_or_none;
alter table public.job_postings validate constraint job_postings_one_off_platform_method;

-- 2. Grants: the host and the kind are readable, the address itself is not --------------------------------------------------------------------------
grant select (apply_link_kind, apply_link_host) on public.job_postings to anon, authenticated;

-- 3. The INSERT policy: the 0275 expression plus the three link columns are null ---------------------------------------------------------------------
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
    and apply_link is null
    and apply_link_kind is null
    and apply_link_host is null
  );

-- 4. The audit trail and the click counter ---------------------------------------------------------------------------------------------------------
create table public.job_posting_apply_link_events (
  id               uuid primary key default gen_random_uuid(),
  job_posting_id   uuid not null,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  actor_user_id    uuid references public.profiles (id) on delete set null,
  old_url          text,
  old_kind         text,
  new_url          text,
  new_kind         text,
  ats_confirmed    boolean not null default false,
  replaced_email   text,
  replaced_by_email boolean not null default false,
  created_at       timestamptz not null default now(),
  check (char_length(old_url) <= 2000),
  check (char_length(new_url) <= 2000),
  check (char_length(replaced_email) <= 254),
  check (old_kind is null or old_kind in ('company', 'ats')),
  check (new_kind is null or new_kind in ('company', 'ats')),
  check (old_url is distinct from new_url),
  check (not replaced_by_email or (new_url is null and old_url is not null))
);

comment on table public.job_posting_apply_link_events is
  '0277: one row per real change of a job''s career-site link (set, change, clear, or cleared because an apply-by-email address replaced it): who, which job, from what, to what, whether the employer confirmed the page is their own, and the address a link replaced. Written only by set_job_apply_link and set_job_apply_email; no API role can read or write it. job_posting_id has no foreign key so a deleted job keeps its trail.';

create index job_posting_apply_link_events_job_idx on public.job_posting_apply_link_events (job_posting_id, created_at desc);

alter table public.job_posting_apply_link_events enable row level security;
revoke all on table public.job_posting_apply_link_events from public, anon, authenticated, service_role;
grant select, insert on table public.job_posting_apply_link_events to service_role;

create table public.apply_link_clicks (
  job_posting_id uuid not null references public.job_postings (id) on delete cascade,
  day            date not null,
  clicks         integer not null default 0 check (clicks >= 0),
  primary key (job_posting_id, day)
);

comment on table public.apply_link_clicks is
  '0277: clicks on a job''s "Apply on company site" button, counted per job per UTC day. No user id, no address, no session: a counter only. Written only by record_apply_link_click (service role).';

alter table public.apply_link_clicks enable row level security;
revoke all on table public.apply_link_clicks from public, anon, authenticated, service_role;
grant select, insert, update on table public.apply_link_clicks to service_role;

-- 5. The only write path for a link: service role only ---------------------------------------------------------------------------------------------
create or replace function public.set_job_apply_link(p_job_id uuid, p_actor uuid, p_url text, p_kind text, p_ats_confirmed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_job     record;
  v_org     record;
  v_host    text;
  v_path    text;
  v_domain  text;
  v_changes integer;
begin
  if p_actor is null then
    raise exception 'Sign in to change how people apply.' using errcode = '28000';
  end if;

  -- The row lock comes first: every check below reads state that another change to this job could be moving.
  select j.id, j.organization_id, j.source_type, j.import_feed_id, j.status, j.removed_at, j.apply_email, j.apply_link, j.apply_link_kind
    into v_job
    from public.job_postings j
   where j.id = p_job_id
     for update;

  -- One answer for "no such job" and "not your job". The actor is a parameter because only the Server Action can call this; membership is still re-checked here.
  if not found or v_job.organization_id is null or not exists (
       select 1 from public.organization_members m
        where m.organization_id = v_job.organization_id
          and m.user_id = p_actor
     ) then
    raise exception 'That job was not found.' using errcode = '42501';
  end if;

  if v_job.source_type <> 'internal'::public.job_source_type
     or v_job.import_feed_id is not null
     or v_job.removed_at is not null
     or v_job.status not in ('draft'::public.job_status, 'open'::public.job_status, 'closed'::public.job_status) then
    raise exception 'This job''s apply method can''t be changed.' using errcode = 'AE004';
  end if;

  if p_url is not null then
    -- The shape of the address, on an already cleaned value: https, at most 2000 characters, no whitespace, a lower-case ASCII host with a dot and no user info or port. Refused, never repaired.
    if p_kind is null or p_kind not in ('company', 'ats')
       or char_length(p_url) > 2000
       or p_url ~ '[[:space:]]'
       or p_url !~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?([/?#][^[:space:]]*)?$' then
      raise exception 'That link can''t be used. Use a full https address on your company''s website or on your applicant tracking system.' using errcode = 'AE005';
    end if;
    v_host := substring(p_url from '^https://([a-z0-9][a-z0-9.-]*[a-z0-9])');
    if v_host is null or position('.' in v_host) = 0 or v_host ~ '(\.\.|(^|\.)-|-(\.|$))' or char_length(v_host) > 253 then
      raise exception 'That link can''t be used. Use a full https address on your company''s website or on your applicant tracking system.' using errcode = 'AE005';
    end if;

    if p_kind = 'company' then
      select o.domain, o.verified into v_org from public.organizations o where o.id = v_job.organization_id;
      v_domain := lower(btrim(coalesce(v_org.domain, '')));
      if not coalesce(v_org.verified, false) or v_domain = '' then
        raise exception 'Your company isn''t verified yet, so a link on your own website can''t be used. Use your applicant tracking page, or finish verifying your company first.' using errcode = 'AE006';
      end if;
      -- The host is the company's domain, or a subdomain of it on a dot boundary ("careers.acme.com" for "acme.com"; never "evilacme.com" or "acme.com.evil.com").
      if not (v_host = v_domain or right(v_host, char_length(v_domain) + 1) = '.' || v_domain) then
        raise exception 'That link can''t be used. Use a full https address on your company''s website or on your applicant tracking system.' using errcode = 'AE005';
      end if;
    else
      -- An applicant-tracking host on the allowlist (the same list as src/lib/jobs/apply-link.ts): exact hosts need a company page path; tenant hosts need exactly one tenant label.
      v_path := substring(p_url from '^https://[^/?#]+(/[^?#]*)');
      if v_host = any (array['boards.greenhouse.io', 'job-boards.greenhouse.io', 'jobs.lever.co', 'apply.workable.com', 'jobs.ashbyhq.com', 'jobs.smartrecruiters.com', 'careers.smartrecruiters.com']) then
        if v_path is null or v_path !~ '^/[^/]+' then
          raise exception 'That link can''t be used. Use a full https address on your company''s website or on your applicant tracking system.' using errcode = 'AE005';
        end if;
      elsif v_host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?\.(bamboohr\.com|recruitee\.com|teamtailor\.com)$' then
        raise exception 'That link can''t be used. Use a full https address on your company''s website or on your applicant tracking system.' using errcode = 'AE005';
      end if;
      if p_ats_confirmed is not true then
        raise exception 'Tick the box to confirm this is your own careers page.' using errcode = 'AE007';
      end if;
    end if;
  end if;

  -- Nothing changes: no audit row and no use of the cap.
  if p_url is not distinct from v_job.apply_link then
    return;
  end if;

  if p_url is not null and v_job.apply_link is null and exists (
       select 1 from public.applications a
        where a.job_posting_id = p_job_id
          and a.source in ('internal_apply'::public.application_source, 'auto_apply'::public.application_source)
     ) then
    raise exception 'This job already has applications on Talentrah, so it can''t be switched to a career-site link. Close it and post a new job instead.' using errcode = 'AE001';
  end if;

  select (select count(*) from public.job_posting_apply_email_events e
           where e.job_posting_id = p_job_id and e.created_at > pg_catalog.now() - interval '24 hours')
       + (select count(*) from public.job_posting_apply_link_events l
           where l.job_posting_id = p_job_id and not l.replaced_by_email and l.created_at > pg_catalog.now() - interval '24 hours')
    into v_changes;
  if v_changes >= 5 then
    raise exception 'This job''s apply method was changed 5 times in the last 24 hours. Try again tomorrow.' using errcode = 'AE002';
  end if;

  if p_url is null then
    update public.job_postings set apply_link = null, apply_link_kind = null, apply_link_host = null where id = p_job_id;
  else
    update public.job_postings set apply_link = p_url, apply_link_kind = p_kind, apply_link_host = v_host, apply_email = null where id = p_job_id;
  end if;

  insert into public.job_posting_apply_link_events (job_posting_id, organization_id, actor_user_id, old_url, old_kind, new_url, new_kind, ats_confirmed, replaced_email)
  values (
    p_job_id, v_job.organization_id, p_actor, v_job.apply_link, v_job.apply_link_kind, p_url,
    case when p_url is null then null else p_kind end,
    p_url is not null and p_kind = 'ats' and p_ats_confirmed is true,
    case when p_url is null then null else v_job.apply_email end
  );
end
$f$;

revoke all on function public.set_job_apply_link(uuid, uuid, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_job_apply_link(uuid, uuid, text, text, boolean) to service_role;

comment on function public.set_job_apply_link(uuid, uuid, text, text, boolean) is
  '0277: the only way job_postings.apply_link is set, changed or cleared (null clears). Service role only: the Server Action validates the link first and passes the signed-in user as p_actor; membership, job state, the link''s shape and both domain paths, the has-applications lock and the shared cap of 5 changes per job per 24 hours are checked again here under the job row lock. Setting a link clears an apply_email.';

-- 6. The employer's own address back, for the edit screen -------------------------------------------------------------------------------------------
create or replace function public.get_job_apply_link(p_job_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $f$
  select j.apply_link
    from public.job_postings j
   where j.id = p_job_id
     and j.organization_id is not null
     and public.is_org_member(j.organization_id);
$f$;

revoke all on function public.get_job_apply_link(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_job_apply_link(uuid) to authenticated;

comment on function public.get_job_apply_link(uuid) is
  '0277: the stored career-site address of a job, for a member of the job''s organisation only (null for everyone else). The column itself has no SELECT grant for any API role.';

-- 7. The click counter -------------------------------------------------------------------------------------------------------------------------------
create or replace function public.record_apply_link_click(p_job_id uuid)
returns void
language sql
security definer
set search_path = ''
as $f$
  insert into public.apply_link_clicks (job_posting_id, day, clicks)
  values (p_job_id, (pg_catalog.now() at time zone 'UTC')::date, 1)
  on conflict (job_posting_id, day) do update set clicks = public.apply_link_clicks.clicks + 1;
$f$;

revoke all on function public.record_apply_link_click(uuid) from public, anon, authenticated, service_role;
grant execute on function public.record_apply_link_click(uuid) to service_role;

comment on function public.record_apply_link_click(uuid) is
  '0277: adds one to the day''s click count for a job. Service role only; the caller treats a failure as nothing happened.';

-- 8. set_job_apply_email: the 0275 function, plus clearing a link and the shared cap -----------------------------------------------------------------
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
  select j.id, j.organization_id, j.source_type, j.import_feed_id, j.status, j.removed_at, j.apply_email, j.apply_link, j.apply_link_kind
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

  select (select count(*) from public.job_posting_apply_email_events e
           where e.job_posting_id = p_job_id and e.created_at > pg_catalog.now() - interval '24 hours')
       + (select count(*) from public.job_posting_apply_link_events l
           where l.job_posting_id = p_job_id and not l.replaced_by_email and l.created_at > pg_catalog.now() - interval '24 hours')
    into v_changes;
  if v_changes >= 5 then
    raise exception 'This job''s apply method was changed 5 times in the last 24 hours. Try again tomorrow.' using errcode = 'AE002';
  end if;

  update public.job_postings set apply_email = p_address, apply_link = null, apply_link_kind = null, apply_link_host = null where id = p_job_id;

  insert into public.job_posting_apply_email_events (job_posting_id, organization_id, actor_user_id, old_address, new_address)
  values (p_job_id, v_job.organization_id, v_actor, v_old, p_address);

  -- A link that an address replaced leaves its own audit row; it is marked so the cap counts this change once.
  if p_address is not null and v_job.apply_link is not null then
    insert into public.job_posting_apply_link_events (job_posting_id, organization_id, actor_user_id, old_url, old_kind, new_url, new_kind, replaced_by_email)
    values (p_job_id, v_job.organization_id, v_actor, v_job.apply_link, v_job.apply_link_kind, null, null, true);
  end if;
end
$f$;

revoke all on function public.set_job_apply_email(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_job_apply_email(uuid, text) to authenticated;

comment on function public.set_job_apply_email(uuid, text) is
  '0275, replaced by 0277: the only way job_postings.apply_email is set, changed or cleared (null clears). Any member of the job''s organisation; one locked check-and-act; refuses a switch to email once an internal_apply or auto_apply application exists; at most 5 changes per job per 24 hours (email and link changes counted together); writes the audit row; setting an address clears a career-site link. authenticated only.';

-- Guard: columns, constraints, grants, policy, functions and tables are what they must be --------------------------------------------------------
do $guard$
declare
  v_check text;
  v_fn    text;
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'job_postings'
         and column_name in ('apply_link', 'apply_link_kind', 'apply_link_host') and data_type = 'text') <> 3 then
    raise exception '0277: job_postings must have the text columns apply_link, apply_link_kind and apply_link_host';
  end if;
  if (select count(*) from pg_constraint
       where conrelid = 'public.job_postings'::regclass
         and conname in ('job_postings_apply_link_length', 'job_postings_apply_link_host_length', 'job_postings_apply_link_kind_known', 'job_postings_apply_link_all_or_none', 'job_postings_one_off_platform_method')
         and convalidated) <> 5 then
    raise exception '0277: the five apply_link constraints must exist and be validated';
  end if;

  if has_column_privilege('anon', 'public.job_postings', 'apply_link', 'SELECT')
     or has_column_privilege('authenticated', 'public.job_postings', 'apply_link', 'SELECT') then
    raise exception '0277: no API role may read job_postings.apply_link';
  end if;
  if not has_column_privilege('anon', 'public.job_postings', 'apply_link_kind', 'SELECT')
     or not has_column_privilege('authenticated', 'public.job_postings', 'apply_link_kind', 'SELECT')
     or not has_column_privilege('anon', 'public.job_postings', 'apply_link_host', 'SELECT')
     or not has_column_privilege('authenticated', 'public.job_postings', 'apply_link_host', 'SELECT') then
    raise exception '0277: anon and authenticated must be able to read apply_link_kind and apply_link_host';
  end if;
  if has_column_privilege('anon', 'public.job_postings', 'apply_link', 'UPDATE')
     or has_column_privilege('authenticated', 'public.job_postings', 'apply_link', 'UPDATE')
     or has_column_privilege('anon', 'public.job_postings', 'apply_link_kind', 'UPDATE')
     or has_column_privilege('authenticated', 'public.job_postings', 'apply_link_kind', 'UPDATE')
     or has_column_privilege('anon', 'public.job_postings', 'apply_link_host', 'UPDATE')
     or has_column_privilege('authenticated', 'public.job_postings', 'apply_link_host', 'UPDATE') then
    raise exception '0277: no client may UPDATE the apply_link columns';
  end if;

  select pg_get_expr(p.polwithcheck, p.polrelid) into v_check
    from pg_policy p
   where p.polrelid = 'public.job_postings'::regclass
     and p.polname = 'org members can manage their org''s internal postings'
     and p.polcmd = 'a';
  if v_check is null then
    raise exception '0277: the job_postings INSERT policy was not found';
  end if;
  if position('(apply_link IS NULL)' in v_check) = 0
     or position('(apply_link_kind IS NULL)' in v_check) = 0
     or position('(apply_link_host IS NULL)' in v_check) = 0
     or position('(apply_email IS NULL)' in v_check) = 0 then
    raise exception '0277: the INSERT policy must require apply_email, apply_link, apply_link_kind and apply_link_host to be null';
  end if;
  if (length(v_check) - length(replace(v_check, 'IS NULL', ''))) / 7 <> 17 then
    raise exception '0277: the INSERT policy must carry exactly 17 null conditions (found %)', (length(v_check) - length(replace(v_check, 'IS NULL', ''))) / 7;
  end if;

  if not exists (select 1 from pg_proc p where p.oid = 'public.set_job_apply_link(uuid, uuid, text, text, boolean)'::regprocedure and p.prosecdef)
     or not exists (select 1 from pg_proc p where p.oid = 'public.get_job_apply_link(uuid)'::regprocedure and p.prosecdef)
     or not exists (select 1 from pg_proc p where p.oid = 'public.record_apply_link_click(uuid)'::regprocedure and p.prosecdef)
     or not exists (select 1 from pg_proc p where p.oid = 'public.set_job_apply_email(uuid, text)'::regprocedure and p.prosecdef) then
    raise exception '0277: the four functions must be SECURITY DEFINER';
  end if;

  -- set_job_apply_link and record_apply_link_click: service role only.
  if has_function_privilege('anon', 'public.set_job_apply_link(uuid, uuid, text, text, boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.set_job_apply_link(uuid, uuid, text, text, boolean)', 'execute')
     or not has_function_privilege('service_role', 'public.set_job_apply_link(uuid, uuid, text, text, boolean)', 'execute') then
    raise exception '0277: set_job_apply_link must be executable by service_role and by nobody else';
  end if;
  if has_function_privilege('anon', 'public.record_apply_link_click(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.record_apply_link_click(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.record_apply_link_click(uuid)', 'execute') then
    raise exception '0277: record_apply_link_click must be executable by service_role and by nobody else';
  end if;
  -- get_job_apply_link and set_job_apply_email: authenticated only (the 0275 grants are kept).
  if has_function_privilege('anon', 'public.get_job_apply_link(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_job_apply_link(uuid)', 'execute')
     or has_function_privilege('anon', 'public.set_job_apply_email(uuid, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.set_job_apply_email(uuid, text)', 'execute') then
    raise exception '0277: get_job_apply_link and set_job_apply_email must be executable by authenticated and not by anon';
  end if;
  for v_fn in
    select p.oid::regprocedure::text
      from pg_proc p
     where p.oid in (
       'public.set_job_apply_link(uuid, uuid, text, text, boolean)'::regprocedure,
       'public.get_job_apply_link(uuid)'::regprocedure,
       'public.record_apply_link_click(uuid)'::regprocedure,
       'public.set_job_apply_email(uuid, text)'::regprocedure
     )
       and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  loop
    raise exception '0277: % is executable by PUBLIC', v_fn;
  end loop;

  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.job_posting_apply_link_events'::regclass)
     or not (select c.relrowsecurity from pg_class c where c.oid = 'public.apply_link_clicks'::regclass) then
    raise exception '0277: the new tables must have row level security';
  end if;
  if has_table_privilege('anon', 'public.job_posting_apply_link_events', 'SELECT, INSERT, UPDATE, DELETE')
     or has_table_privilege('authenticated', 'public.job_posting_apply_link_events', 'SELECT, INSERT, UPDATE, DELETE')
     or has_any_column_privilege('anon', 'public.job_posting_apply_link_events', 'SELECT')
     or has_any_column_privilege('authenticated', 'public.job_posting_apply_link_events', 'SELECT')
     or has_table_privilege('anon', 'public.apply_link_clicks', 'SELECT, INSERT, UPDATE, DELETE')
     or has_table_privilege('authenticated', 'public.apply_link_clicks', 'SELECT, INSERT, UPDATE, DELETE')
     or has_any_column_privilege('anon', 'public.apply_link_clicks', 'SELECT')
     or has_any_column_privilege('authenticated', 'public.apply_link_clicks', 'SELECT') then
    raise exception '0277: the new tables are reachable by an API role';
  end if;
  if not has_table_privilege('service_role', 'public.job_posting_apply_link_events', 'SELECT')
     or not has_table_privilege('service_role', 'public.job_posting_apply_link_events', 'INSERT')
     or not has_table_privilege('service_role', 'public.apply_link_clicks', 'SELECT')
     or not has_table_privilege('service_role', 'public.apply_link_clicks', 'INSERT')
     or not has_table_privilege('service_role', 'public.apply_link_clicks', 'UPDATE') then
    raise exception '0277: service_role must be able to use the new tables';
  end if;
end
$guard$;
