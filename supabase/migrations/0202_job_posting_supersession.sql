-- 0202 — a duplicate posting is SUPERSEDED by the one we keep, never deleted. S12 (b).
--
-- ── WHAT THIS IS ──────────────────────────────────────────────────────────
--
-- The same job listed more than once by a source (Workable posts one requisition once per city; the three
-- "Client Project Manager … Remote South Africa" rows and the two "Employment Lawyer (Remote, South Africa)" rows were
-- measured on production on 2026-10-01) shows as separate cards with separate pages. The rule, approved 2026-10-01:
-- two OPEN external postings are the same job when company, title, LOCATION and description are the same, case and
-- whitespace aside, and the description is at least 80 characters (a one-line "Drive the van." proves nothing). The
-- freshest is kept. A per-city variant — same text, different location — is a different listing and is never touched.
--
-- "Superseded" is its own state, deliberately not status = 'closed': closed means the SOURCE withdrew the job, and the
-- freshness sweep and the reopen path both act on it; reusing it would make a duplicate indistinguishable from a closed
-- job and let ingestion flip it back. A superseded row keeps status 'open', is hidden everywhere public, and points at
-- the row that replaced it so its old URL can 308 there.
--
-- ── WHO CAN SEE A SUPERSEDED ROW ──────────────────────────────────────────
--
-- RLS is how almost every public surface enforces visibility, so the exclusion goes in the SELECT policy — in the four
-- non-member branches, independently, the shape 0107 and 0190 chose so that a branch which quietly omitted it could not
-- readmit one. The org-member branch stays unconditional, as it is for 'removed' and 'draft'. Everything that is
-- SECURITY INVOKER (the feed, search_job_postings, job_landing_facet_counts, the sitemap, the job page) inherits it.
--
-- A SECURITY DEFINER function does NOT inherit a policy (CLAUDE.md, 0109), so the two that read job_postings on a
-- public path are redefined here with the same one-line exclusion and nothing else changed: auto_apply_claim_submission
-- (a superseded job is refused as 'job_closed') and promoted_jobs. Each body below is the live definition read from
-- production on 2026-10-01.
--
-- ── WHO CAN WRITE IT ──────────────────────────────────────────────────────
--
-- Nobody but the server. UPDATE is already column-granted, so a client cannot touch the new columns; INSERT is a
-- table-level grant, so a trigger refuses a posting that arrives carrying either column from `authenticated`/`anon`.
-- The two functions that set it are service-role only.
--
-- ── NOTHING IS APPLIED BY THIS MIGRATION ──────────────────────────────────
--
-- It adds columns, a narrower policy and functions. No row is marked. Both functions take an optional company list: ingestion
-- passes the companies it touched in a run (bounded work, and parallel test files cannot hit each other's fixtures); the
-- dry run and the first marking pass nothing and see the whole table. With no superseded row the policy change is
-- behaviourally identical to the old one, which is why this is safe to apply before the deploy. Marking is a separate,
-- reviewed production write: `select * from job_supersession_plan()` is the dry run; `apply_job_supersession()` is the write.

alter table public.job_postings
  add column if not exists superseded_by uuid references public.job_postings (id) on delete set null,
  add column if not exists superseded_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'job_postings_superseded_consistent') then
    alter table public.job_postings
      add constraint job_postings_superseded_consistent check (superseded_by is null or superseded_at is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'job_postings_superseded_not_self') then
    alter table public.job_postings
      add constraint job_postings_superseded_not_self check (superseded_by is null or superseded_by <> id);
  end if;
end $$;

create index if not exists job_postings_superseded_by_idx
  on public.job_postings (superseded_by) where superseded_by is not null;

comment on column public.job_postings.superseded_by is
  'The open posting that replaced this duplicate (same company, title, location and description). Set only by apply_job_supersession(); a superseded row keeps status open and is hidden from every public read.';
comment on column public.job_postings.superseded_at is
  'When this posting was superseded. Hides it from every public read (see the SELECT policy). Cleared by apply_job_supersession() when its keeper leaves the open set.';

-- ── THE SELECT POLICY ─────────────────────────────────────────────────────
-- Current text confirmed live before writing this (0190's definition, unmodified since): five OR-branches.
drop policy "job postings are publicly readable" on public.job_postings;

create policy "job postings are publicly readable"
  on public.job_postings
  for select
  using (
    (source_type = 'external'::job_source_type
      and status <> 'removed'::job_status and status <> 'draft'::job_status
      and superseded_at is null)
    or (
      exists (
        select 1 from public.organizations o
        where o.id = job_postings.organization_id and o.verified
      )
      and status <> 'removed'::job_status and status <> 'draft'::job_status
      and superseded_at is null
    )
    or (unlisted_at is not null
      and status <> 'removed'::job_status and status <> 'draft'::job_status
      and superseded_at is null)
    or (admin_review_decision = 'approved'::text
      and status <> 'removed'::job_status and status <> 'draft'::job_status
      and superseded_at is null)
    or is_org_member(organization_id)
  );

do $$
declare
  policy_text text;
  mentions integer;
begin
  select pg_get_expr(polqual, polrelid) into policy_text
  from pg_policy
  where polrelid = 'public.job_postings'::regclass and polname = 'job postings are publicly readable';
  if policy_text is null then
    raise exception 'the job_postings SELECT policy is missing after this migration''s own rewrite.';
  end if;
  select count(*) into mentions from regexp_matches(policy_text, 'superseded_at', 'g');
  if mentions < 4 then
    raise exception
      'the job_postings SELECT policy mentions superseded_at % time(s), expected 4 (one per non-member branch) — an exclusion was lost from at least one branch.',
      mentions;
  end if;
end $$;

-- ── NO CLIENT WRITES IT ───────────────────────────────────────────────────
create or replace function public.job_postings_guard_supersession()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.superseded_by is not null or new.superseded_at is not null then
        raise exception 'superseded_by / superseded_at are server-managed' using errcode = '42501';
      end if;
    elsif new.superseded_by is distinct from old.superseded_by
       or new.superseded_at is distinct from old.superseded_at then
      raise exception 'superseded_by / superseded_at are server-managed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists job_postings_guard_supersession on public.job_postings;
create trigger job_postings_guard_supersession
  before insert or update on public.job_postings
  for each row execute function public.job_postings_guard_supersession();

-- ── THE PLAN (a read) AND THE APPLY (the write) ───────────────────────────
-- Rows grouped on company + title + location + description, whitespace and case folded; the freshest posted_at wins,
-- ties going to the earlier-created row and then the lower id, so the choice is deterministic. Only OPEN EXTERNAL rows
-- with a description of at least 80 characters take part. The plan lists the LOSERS, each with the row that replaces it.
create or replace function public.job_supersession_plan(p_companies text[] default null)
returns table (
  job_id uuid,
  keeper_id uuid,
  company_name text,
  title text,
  location text,
  posted_at timestamptz,
  external_url text,
  keeper_posted_at timestamptz,
  keeper_external_url text,
  group_size integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with open_ext as (
    select j.id, j.company_name, j.title, j.location, j.external_url, j.posted_at, j.created_at,
           lower(btrim(j.company_name)) as c,
           lower(btrim(j.title)) as t,
           lower(btrim(coalesce(j.location, ''))) as l,
           md5(regexp_replace(lower(btrim(j.description)), '\s+', ' ', 'g')) as d
      from public.job_postings j
     where j.source_type = 'external'
       and j.status = 'open'
       and j.posted_at is not null
       and length(btrim(coalesce(j.description, ''))) >= 80
       -- Optional scope. Groups are per company, so restricting by company never splits a group.
       and (p_companies is null
            or lower(btrim(j.company_name)) in (select lower(btrim(x)) from unnest(p_companies) as x))
  ), ranked as (
    select o.*,
           count(*) over (partition by o.c, o.t, o.l, o.d) as n,
           first_value(o.id) over (partition by o.c, o.t, o.l, o.d order by o.posted_at desc, o.created_at asc, o.id asc) as keeper,
           row_number() over (partition by o.c, o.t, o.l, o.d order by o.posted_at desc, o.created_at asc, o.id asc) as rn
      from open_ext o
  )
  select r.id, r.keeper, r.company_name, r.title, r.location, r.posted_at, r.external_url,
         k.posted_at, k.external_url, r.n::integer
    from ranked r
    join ranked k on k.id = r.keeper
   where r.rn > 1;
$$;

create or replace function public.apply_job_supersession(p_companies text[] default null)
returns table (superseded integer, restored integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_superseded integer;
  v_restored integer;
begin
  -- Mark, or re-point, every loser the plan lists.
  with plan as (select p.job_id, p.keeper_id from public.job_supersession_plan(p_companies) p),
       upd as (
         update public.job_postings j
            set superseded_by = plan.keeper_id,
                superseded_at = coalesce(j.superseded_at, now())
           from plan
          where j.id = plan.job_id
            and j.superseded_by is distinct from plan.keeper_id
         returning 1
       )
  select count(*)::integer into v_superseded from upd;

  -- Un-hide an OPEN row the plan no longer lists: its keeper left the open set (closed, removed) or the text diverged.
  -- It stays status open throughout; this only clears the flag, so the job reappears while the source still lists it.
  with plan as (select p.job_id from public.job_supersession_plan(p_companies) p),
       upd as (
         update public.job_postings j
            set superseded_by = null, superseded_at = null
          where j.superseded_at is not null
            and j.status = 'open'
            and (p_companies is null
                 or lower(btrim(j.company_name)) in (select lower(btrim(x)) from unnest(p_companies) as x))
            and not exists (select 1 from plan where plan.job_id = j.id)
         returning 1
       )
  select count(*)::integer into v_restored from upd;

  -- A review-queue entry for a job that is now hidden would render as "Untitled role at Unknown company" (the queue row
  -- carries no snapshot) and could never be confirmed (auto_apply_claim_submission refuses it as job_closed). Expire it,
  -- the same terminal state that refusal uses; the keeper reaches the user through the normal scan if it matches.
  update public.auto_apply_queue q
     set status = 'expired', decided_at = now()
   where q.status = 'pending'
     and exists (select 1 from public.job_postings j where j.id = q.job_posting_id and j.superseded_at is not null);

  return query select v_superseded, v_restored;
end;
$$;

-- A superseded row's old URL needs to know where to send the visitor, and RLS (rightly) hides that row from them.
-- This returns ONLY the id of the open, visible replacement — nothing else about either row.
create or replace function public.superseded_job_target(p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select k.id
    from public.job_postings j
    join public.job_postings k on k.id = j.superseded_by
   where j.id = p_id
     and j.superseded_at is not null
     and k.source_type = 'external'
     and k.status = 'open'
     and k.superseded_at is null;
$$;

revoke all on function public.job_supersession_plan(text[]) from public, anon, authenticated;
revoke all on function public.apply_job_supersession(text[]) from public, anon, authenticated;
grant execute on function public.job_supersession_plan(text[]) to service_role;
grant execute on function public.apply_job_supersession(text[]) to service_role;
revoke all on function public.superseded_job_target(uuid) from public;
grant execute on function public.superseded_job_target(uuid) to anon, authenticated, service_role;

-- ── THE TWO DEFINER FUNCTIONS ON A PUBLIC PATH ────────────────────────────
-- One added condition in each; everything else is the live body.
CREATE OR REPLACE FUNCTION public.auto_apply_claim_submission(p_user_id uuid, p_queue_id uuid, p_min_score integer, p_daily_cap integer, p_free_per_week integer, p_credit_cost integer, p_has_active_pass boolean DEFAULT false)
 RETURNS TABLE(ok boolean, reason text, charge integer, job_posting_id uuid, source_type job_source_type, pass_covered boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.auto_apply_queue%rowtype;
  v_live_score integer;
  v_explanation jsonb;
  v_matched_count integer;
  v_missing_count integer;
  v_job_open boolean;
  v_used_24h integer;
  v_used_7d integer;
  v_charge integer := 0;
  v_balance integer;
  v_pass_covered boolean := false;
begin
  insert into public.auto_apply_settings (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  perform 1 from public.auto_apply_settings s where s.user_id = p_user_id for update;

  select q.* into v_row from public.auto_apply_queue q
    where q.id = p_queue_id and q.user_id = p_user_id;
  if not found then
    return query select false, 'not_found'::text, 0, null::uuid, null::public.job_source_type, false;
    return;
  end if;
  if v_row.status <> 'pending' then
    return query select false, 'already_decided'::text, 0, v_row.job_posting_id, v_row.source_type, false;
    return;
  end if;

  -- 0202: a superseded duplicate is not an open job for this purpose — the same refusal a closed one gets.
  select (j.status = 'open' and j.superseded_at is null) into v_job_open
    from public.job_postings j where j.id = v_row.job_posting_id;
  if v_job_open is distinct from true then
    update public.auto_apply_queue q set status = 'expired', decided_at = now() where q.id = p_queue_id;
    return query select false, 'job_closed'::text, 0, v_row.job_posting_id, v_row.source_type, false;
    return;
  end if;

  -- Live, not snapshotted — same reasoning as always (0034's own header).
  select ms.score, ms.explanation into v_live_score, v_explanation from public.match_scores ms
    where ms.user_id = p_user_id and ms.job_posting_id = v_row.job_posting_id;
  if v_live_score is null or v_live_score < p_min_score then
    return query select false, 'below_threshold'::text, 0, v_row.job_posting_id, v_row.source_type, false;
    return;
  end if;

  -- A thin screenable-tag denominator is refused UNCONDITIONALLY here, even
  -- though queue.ts (src/lib/auto-apply/queue.ts) also excludes these at
  -- queuing time so a user shouldn't normally see one reach this gate at
  -- all. This re-check is the real backstop: it is what actually decides,
  -- the same way the live score re-check above is the real backstop for the
  -- threshold, not the queue row's stale snapshot.
  v_matched_count := coalesce(jsonb_array_length(v_explanation -> 'matchedSkills'), 0);
  v_missing_count := coalesce(jsonb_array_length(v_explanation -> 'missingSkills'), 0);
  if (v_matched_count + v_missing_count) <= 2 then
    return query select false, 'thin_match'::text, 0, v_row.job_posting_id, v_row.source_type, false;
    return;
  end if;

  -- External postings are handed off, never submitted: no cap, no charge.
  -- Claimed here so the log records the hand-off, but it costs nothing.
  if v_row.source_type = 'external' then
    update public.auto_apply_queue q
      set status = 'handed_off', decided_at = now()
      where q.id = p_queue_id;
    return query select true, 'handed_off'::text, 0, v_row.job_posting_id, v_row.source_type, false;
    return;
  end if;

  select count(*) into v_used_24h from public.auto_apply_queue q
    where q.user_id = p_user_id and q.status = 'submitted'
      and q.decided_at > now() - interval '24 hours';
  if v_used_24h >= p_daily_cap then
    return query select false, 'daily_cap'::text, 0, v_row.job_posting_id, v_row.source_type, false;
    return;
  end if;

  select count(*) into v_used_7d from public.auto_apply_queue q
    where q.user_id = p_user_id and q.status = 'submitted'
      and q.decided_at > now() - interval '7 days';
  if v_used_7d >= p_free_per_week then
    if p_has_active_pass then
      v_pass_covered := true;
    else
      v_charge := p_credit_cost;
      select p.credits_balance into v_balance from public.profiles p where p.id = p_user_id;
      if coalesce(v_balance, 0) < v_charge then
        return query select false, 'insufficient_credits'::text, v_charge,
                            v_row.job_posting_id, v_row.source_type, false;
        return;
      end if;
    end if;
  end if;

  update public.auto_apply_queue q
    set status = 'submitted', decided_at = now(), credits_spent = v_charge
    where q.id = p_queue_id;

  return query select true, 'submitted'::text, v_charge, v_row.job_posting_id, v_row.source_type, v_pass_covered;
end;
$function$;

CREATE OR REPLACE FUNCTION public.promoted_jobs(p_min_score integer DEFAULT 60, p_work_types work_type[] DEFAULT NULL::work_type[], p_seniorities seniority_level[] DEFAULT NULL::seniority_level[], p_limit integer DEFAULT 2)
 RETURNS TABLE(job_posting_id uuid, campaign_id uuid, match_score integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select j.id, c.id, ms.score
    from public.ad_campaigns c
    join public.job_postings j
      on j.id = c.job_posting_id
     and j.status = 'open'
     -- NEW (0202). A paid slot never shows a superseded duplicate either.
     and j.superseded_at is null
    join public.match_scores ms
      on ms.job_posting_id = j.id
     and ms.user_id = (select auth.uid())
   where (select auth.uid()) is not null
     and c.status = 'active'
     and (c.ends_on is null or current_date <= c.ends_on)
     -- NEW (0109). A paid slot clears the same verification gate as an
     -- organic one. Anchored on the POSTING's organisation, because it is the
     -- posting that gets listed.
     and exists (
       select 1 from public.organizations o
        where o.id = j.organization_id
          and o.verified
     )
     -- D1: the seeker's own filters and threshold bind a paid slot exactly as
     -- they bind an organic one. A null array means "no filter applied" —
     -- the feed passes null, not an empty array, when a dimension is unset.
     and ms.score >= p_min_score
     and (p_work_types is null or j.work_type = any (p_work_types))
     and (p_seniorities is null or j.seniority = any (p_seniorities))
     -- The employer's targeting, unchanged.
     and (c.target_locations is null or j.location = any (c.target_locations))
     and (c.target_seniority is null or j.seniority = any (c.target_seniority))
     and (c.target_employment_type is null or j.employment_type = any (c.target_employment_type))
   order by ms.score desc, c.created_at asc
   limit greatest(p_limit, 0);
$function$;

-- ── THE SWITCH ────────────────────────────────────────────────────────────
-- Ingestion calls apply_job_supersession() after each run ONLY while this flag is on. It is created OFF: marking rows
-- is a production write that waits for a reviewed dry run (the first marking is done by hand from the plan).
insert into public.feature_flags (key, label, enabled) values
  ('job_supersession', 'Hide duplicate postings after each ingest run (S12 b, migration 0202)', false)
on conflict (key) do nothing;

-- Self-check: the plan runs and the redefined functions still carry their grants.
do $$
begin
  perform count(*) from public.job_supersession_plan();
  if has_function_privilege('anon', 'public.apply_job_supersession(text[])', 'execute') then
    raise exception 'apply_job_supersession must not be executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.promoted_jobs(integer, work_type[], seniority_level[], integer)', 'execute') then
    raise exception 'promoted_jobs lost its authenticated EXECUTE grant when redefined';
  end if;
end $$;
