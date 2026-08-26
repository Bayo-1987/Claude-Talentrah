-- 0052 — the serving side of ad campaigns: an event log, and the one function
-- the seeker feed is allowed to ask "which jobs are promoted for me".
--
-- Campaigns have been chargeable since 0047 and visible to nobody since 0047.
-- This is the half that makes the charge correspond to something.

-- ---------------------------------------------------------------------------
-- ad_events
-- ---------------------------------------------------------------------------
create type public.ad_event_type as enum ('impression', 'click', 'apply');

/*
 * WHY THE DEDUP KEY IS A COLUMN AND NOT A LATER GROUP BY. §8 requires ad events
 * to be deduplicated and attributable BEFORE billing touches them. Billing is
 * per-day today and does not read this table at all — but CPC is the stated
 * next step (§6.8), and a log that was never dedupable cannot be made billable
 * afterwards. The uniqueness has to be structural from the first row or the
 * history is worthless for the thing it exists for.
 *
 * `user_id` is NOT NULL on purpose. The feed is authenticated-only, so every
 * event this table can currently receive has a user. Making it nullable "just
 * in case" would mean the unique index needs a sentinel to dedup anonymous
 * rows, and a sentinel that never occurs is a hole waiting for the day it
 * does. When signed-out surfaces start serving ads, that is a migration with a
 * decision attached, not a null this table quietly already allowed.
 */
create table if not exists public.ad_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type public.ad_event_type not null,
  surface text not null default 'job_feed',
  dedup_bucket text not null,
  occurred_at timestamptz not null default now()
);

create unique index if not exists ad_events_dedup_idx
  on public.ad_events (campaign_id, user_id, event_type, dedup_bucket);
create index if not exists ad_events_campaign_idx
  on public.ad_events (campaign_id, occurred_at desc);

alter table public.ad_events enable row level security;

-- The employer may read their own campaigns' events; that is the analytics
-- surface. Nobody may write through the client — an event log a user can
-- author is an invoice a user can author, which is the 0031 lesson applied to
-- the table that CPC would eventually bill from.
create policy "org members read their own campaign events"
  on public.ad_events for select
  using (exists (
    select 1 from public.ad_campaigns c
     where c.id = ad_events.campaign_id
       and public.is_org_member(c.organization_id)
  ));

revoke insert, update, delete on public.ad_events from anon, authenticated;

/*
 * The bucket is computed HERE rather than by the caller, so no caller can get
 * it wrong and quietly disable dedup for its own events.
 *
 * Impressions and applies bucket by DAY: the same person seeing the same
 * promoted job twice in a day is one impression worth billing for, and a feed
 * that re-renders on every filter change would otherwise inflate the count
 * enormously. Clicks bucket by MINUTE — a genuine second click an hour later
 * is real intent, a double-click is not.
 */
create or replace function public.record_ad_event(
  p_campaign_id uuid,
  p_job_posting_id uuid,
  p_user_id uuid,
  p_event_type public.ad_event_type,
  p_surface text default 'job_feed'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket text;
  v_inserted integer;
begin
  v_bucket := case p_event_type
    when 'click' then to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI')
    else to_char(now() at time zone 'utc', 'YYYY-MM-DD')
  end;

  insert into public.ad_events
    (campaign_id, job_posting_id, user_id, event_type, surface, dedup_bucket)
  values
    (p_campaign_id, p_job_posting_id, p_user_id, p_event_type, p_surface, v_bucket)
  on conflict (campaign_id, user_id, event_type, dedup_bucket) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

revoke all on function public.record_ad_event(uuid, uuid, uuid, public.ad_event_type, text)
  from public, anon, authenticated;
grant execute on function public.record_ad_event(uuid, uuid, uuid, public.ad_event_type, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- promoted_jobs
-- ---------------------------------------------------------------------------
/*
 * THE SEEKER'S CLIENT CANNOT READ ad_campaigns AND MUST NOT BE ABLE TO.
 * That table's only SELECT policy is `is_org_member(organization_id)`, so a job
 * seeker sees nothing — correctly, since it holds budgets, spend and review
 * notes. This function is the narrow hole through it: it returns job ids and
 * campaign ids and nothing else, so serving works without exposing a single
 * money column.
 *
 * IT TAKES NO USER ID, DELIBERATELY. The obvious signature had `p_user_id`, and
 * it would have been a data leak: this is SECURITY DEFINER and executable by
 * `authenticated`, so any signed-in caller could pass someone else's id and
 * read that person's match scores back. The user is taken from auth.uid()
 * instead, which the caller cannot forge. Called as service_role auth.uid() is
 * null and the function returns nothing, which is the right answer — there is
 * no such thing as a promoted set with no seeker to promote to.
 *
 * D1, DECIDED 2026-08-26: PAYMENT DOES NOT OVERRIDE RELEVANCE. A promoted job
 * must satisfy the seeker's active filters and clear the same match threshold
 * as an organic result. The match score is the product's central claim; a paid
 * placement that ignored it would discredit every other score on the page. So
 * the filters are arguments here rather than something the feed applies
 * afterwards — filtering after the fact would return a promoted job and then
 * hide it, silently costing the employer an impression for something nobody
 * saw.
 */
create or replace function public.promoted_jobs(
  p_min_score integer default 60,
  p_work_type public.work_type default null,
  p_seniority public.seniority_level default null,
  p_limit integer default 2
)
returns table (job_posting_id uuid, campaign_id uuid, match_score integer)
language sql
stable
security definer
set search_path = public
as $$
  select j.id, c.id, ms.score
    from public.ad_campaigns c
    join public.job_postings j
      on j.id = c.job_posting_id
     and j.status = 'open'
    join public.match_scores ms
      on ms.job_posting_id = j.id
     and ms.user_id = (select auth.uid())
   where (select auth.uid()) is not null
     and c.status = 'active'
     and (c.ends_on is null or current_date <= c.ends_on)
     -- D1: the seeker's own filters and threshold bind a paid slot exactly as
     -- they bind an organic one.
     and ms.score >= p_min_score
     and (p_work_type is null or j.work_type = p_work_type)
     and (p_seniority is null or j.seniority = p_seniority)
     -- The employer's targeting. A null array means "untargeted", not "matches
     -- nothing" — the campaign form leaves these empty by default.
     and (c.target_locations is null or j.location = any (c.target_locations))
     and (c.target_seniority is null or j.seniority = any (c.target_seniority))
     and (c.target_employment_type is null or j.employment_type = any (c.target_employment_type))
   order by ms.score desc, c.created_at asc
   limit greatest(p_limit, 0);
$$;

revoke all on function public.promoted_jobs(integer, public.work_type, public.seniority_level, integer)
  from public, anon;
grant execute on function public.promoted_jobs(integer, public.work_type, public.seniority_level, integer)
  to authenticated, service_role;
