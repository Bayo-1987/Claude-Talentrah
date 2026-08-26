-- 0047 — Ad campaigns: state machine, review gate, and an atomic resume.
--
-- Design brief: docs/employer-billing-plan.md. §4 (pause at zero) and §7.4
-- (who can spend) are the two sections this implements.
--
-- ---------------------------------------------------------------------------
-- Why a daily rate rather than one upfront charge
-- ---------------------------------------------------------------------------
-- §6.8 says flat-rate first, which leaves open whether "flat rate" means one
-- charge for a run or a fixed charge per day. It has to be per day, because a
-- single upfront charge makes `paused_insufficient_funds` unreachable — you
-- cannot run out of money for something already paid for. A daily rate is also
-- the version an employer can stop cheaply, which matches the cancel-anytime
-- posture the Pass product already takes.
--
-- This is still NOT metering. The charge does not depend on impressions or
-- clicks; it is a fixed daily price for being listed. CPC stays deferred until
-- attribution is trustworthy (§6.8), and that is a dedup/idempotency problem in
-- its own right.
--
-- ---------------------------------------------------------------------------
-- Two pause states, deliberately not one state with a reason column
-- ---------------------------------------------------------------------------
-- `paused_by_employer` and `paused_insufficient_funds` differ in three ways
-- that a nullable `pause_reason` would blur:
--   * who caused it — the employer, or us;
--   * what the employer is told — "you paused this" vs "we could not charge
--     your wallet";
--   * what resuming requires — a click, versus a click that must first prove
--     the money is there.
-- Anything the code branches on three ways is a state, not an annotation.

create type public.ad_campaign_status as enum (
  'draft',                      -- being written, never charged
  'pending_review',             -- submitted; §6.8's review gate
  'rejected',                   -- reviewer said no; terminal unless re-drafted
  'active',                     -- live and being charged daily
  'paused_by_employer',         -- deliberate
  'paused_insufficient_funds',  -- the wallet could not cover a day
  'completed'                   -- ran to its end date or exhausted its budget
);

create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- What is being promoted. Restricted to the org's own postings by the RLS
  -- policy below; a campaign pointing at someone else's job would be an ad
  -- for a competitor paid for by the victim.
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,
  name text not null,
  status public.ad_campaign_status not null default 'draft',

  -- Money. Whole naira, matching ad_wallets and payment_transactions — see
  -- 0046 on why a second money unit is not introduced.
  daily_rate_ngn integer not null,
  -- The cap. A campaign completes when spend reaches it, so an employer cannot
  -- be surprised by an open-ended run.
  total_budget_ngn integer not null,
  spent_ngn integer not null default 0,
  last_charged_on date,

  starts_on date not null default current_date,
  ends_on date,

  -- Targeting. Null means "no restriction on this axis" rather than "matches
  -- nothing" — an empty campaign that reaches nobody is a worse default than
  -- one that reaches everyone, because the employer paid either way.
  target_locations text[],
  target_seniority public.seniority_level[],
  target_employment_type public.employment_type[],

  -- Review gate (§6.8). Same shape as the scholarship moderation gate: the
  -- reviewer is recorded, and so is the reason, because "rejected" with no
  -- explanation is not a review.
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_note text,

  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ad_campaigns_daily_rate_positive check (daily_rate_ngn > 0),
  constraint ad_campaigns_budget_covers_a_day check (total_budget_ngn >= daily_rate_ngn),
  constraint ad_campaigns_spent_non_negative check (spent_ngn >= 0),
  constraint ad_campaigns_ends_after_starts check (ends_on is null or ends_on >= starts_on)
);

create index if not exists ad_campaigns_org_idx on public.ad_campaigns (organization_id, created_at desc);
create index if not exists ad_campaigns_review_queue_idx on public.ad_campaigns (submitted_at)
  where status = 'pending_review';
-- The daily charge job's work-list.
create index if not exists ad_campaigns_chargeable_idx on public.ad_campaigns (last_charged_on)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Members read and draft their own campaigns. Everything that moves money or
-- changes review state goes through a SECURITY DEFINER function instead, for
-- the reason this repo has now learned five times: a row policy does not
-- restrict columns, so a permissive UPDATE policy would let a member set
-- `status = 'active'`, `spent_ngn = 0`, or `reviewed_by` themselves.
alter table public.ad_campaigns enable row level security;

create policy "org members read their own campaigns"
  on public.ad_campaigns for select
  using (public.is_org_member(organization_id));

create policy "org members create draft campaigns for their own postings"
  on public.ad_campaigns for insert
  with check (
    public.is_org_member(organization_id)
    -- Draft only. Going live is a reviewed transition, never an insert.
    and status = 'draft'
    and spent_ngn = 0
    and created_by = (select auth.uid())
    -- The posting must belong to the same org.
    and exists (
      select 1 from public.job_postings j
       where j.id = job_posting_id and j.organization_id = ad_campaigns.organization_id
    )
  );

-- Editing a draft is the only client-side UPDATE, and only these columns.
-- Order matters: the table-level revoke must come before the column grant, or
-- the grant is overridden. That ordering is what 0028/0030 got wrong once.
revoke update on public.ad_campaigns from anon, authenticated;
grant update (name, daily_rate_ngn, total_budget_ngn, starts_on, ends_on,
              target_locations, target_seniority, target_employment_type, updated_at)
  on public.ad_campaigns to authenticated;

create policy "org members edit their own DRAFT campaigns"
  on public.ad_campaigns for update
  using (public.is_org_member(organization_id) and status = 'draft')
  with check (public.is_org_member(organization_id) and status = 'draft');

create policy "org members delete their own draft campaigns"
  on public.ad_campaigns for delete
  using (public.is_org_member(organization_id) and status = 'draft');

-- ---------------------------------------------------------------------------
-- The state machine
-- ---------------------------------------------------------------------------
-- Enforced by trigger rather than in a Server Action, for the same reason as
-- 0037: the table has a permissive owner-scoped policy, so any app-layer rule
-- is reachable around with a direct PATCH. service_role is exempt because the
-- transitions below are performed BY the functions that own them.
create or replace function public.enforce_ad_campaign_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  -- A client may only ever submit a draft for review. Every other transition
  -- moves money, changes what the public sees, or records a review decision,
  -- and belongs to a function.
  if old.status = 'draft' and new.status = 'pending_review' then
    return new;
  end if;

  raise exception
    'Campaigns cannot be moved from % to % directly — use the campaign actions',
    old.status, new.status
    using errcode = 'check_violation';
end;
$$;

create trigger enforce_ad_campaign_transition
  before update of status on public.ad_campaigns
  for each row execute function public.enforce_ad_campaign_transition();

-- ---------------------------------------------------------------------------
-- charge_ad_campaign_day — one day's charge, atomically
-- ---------------------------------------------------------------------------
-- Wraps debit_ad_wallet so a campaign's spend and the wallet's balance move
-- together. Idempotent on `last_charged_on`: the daily cron is best-effort and
-- may run twice (Vercel Cron delivery is not exactly-once — the Pass renewal
-- job carries the same note), and charging a campaign twice for one day is the
-- kind of error a customer notices.
--
-- On failure the campaign moves to `paused_insufficient_funds` rather than
-- being left `active` and silently undelivered. §4: pause and surface, never
-- proceed and reconcile.
create or replace function public.charge_ad_campaign_day(
  p_campaign_id uuid,
  p_on_date date default current_date
)
returns table (ok boolean, status public.ad_campaign_status, balance_after_ngn integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.ad_campaigns%rowtype;
  v_debit record;
  v_remaining integer;
  v_charge integer;
begin
  -- Lock the campaign for the duration: two concurrent cron runs must not both
  -- decide the same day is unpaid.
  select * into c from public.ad_campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'charge_ad_campaign_day: no campaign %', p_campaign_id;
  end if;

  if c.status <> 'active' then
    return query select false, c.status, null::integer; return;
  end if;
  if c.last_charged_on is not null and c.last_charged_on >= p_on_date then
    -- Already charged for this day. Not an error — a duplicate cron run.
    return query select true, c.status, null::integer; return;
  end if;
  if c.ends_on is not null and p_on_date > c.ends_on then
    update public.ad_campaigns set status = 'completed', updated_at = now() where id = c.id;
    return query select true, 'completed'::public.ad_campaign_status, null::integer; return;
  end if;

  -- Never charge past the cap, and never charge a partial day into a budget
  -- that cannot cover one: the constraint guarantees budget >= daily_rate at
  -- creation, so a remainder smaller than a day means the cap is reached.
  v_remaining := c.total_budget_ngn - c.spent_ngn;
  if v_remaining < c.daily_rate_ngn then
    update public.ad_campaigns set status = 'completed', updated_at = now() where id = c.id;
    return query select true, 'completed'::public.ad_campaign_status, null::integer; return;
  end if;
  v_charge := c.daily_rate_ngn;

  select * into v_debit from public.debit_ad_wallet(
    c.organization_id, v_charge, 'campaign_charge', c.id, null
  );

  if not v_debit.ok then
    update public.ad_campaigns
       set status = 'paused_insufficient_funds', updated_at = now()
     where id = c.id;
    return query select false, 'paused_insufficient_funds'::public.ad_campaign_status,
                        v_debit.balance_after_ngn;
    return;
  end if;

  update public.ad_campaigns
     set spent_ngn = c.spent_ngn + v_charge,
         last_charged_on = p_on_date,
         updated_at = now()
   where id = c.id;

  return query select true, 'active'::public.ad_campaign_status, v_debit.balance_after_ngn;
end;
$$;

-- ---------------------------------------------------------------------------
-- resume_ad_campaign — the affordability check IS the charge
-- ---------------------------------------------------------------------------
-- The important property, and the reason this is a function rather than a
-- status update in a Server Action:
--
-- RESUMING MUST NOT TRUST THE BALANCE THAT CAUSED THE PAUSE. Time has passed,
-- and — the part that makes it structural rather than a timing detail — OTHER
-- CAMPAIGNS IN THE SAME ORGANISATION DRAW FROM THE SAME WALLET. The balance at
-- pause time is stale by construction, not merely by age.
--
-- So resume does not read the balance and decide. It charges a day through
-- `debit_ad_wallet`, whose conditional UPDATE is the check. Success activates;
-- failure leaves the campaign paused. A read-then-decide here would be the
-- 0035 shape a third time.
--
-- Authorisation is the caller's job (see the note in the campaign actions):
-- p_actor_user_id is recorded, not trusted, exactly as in debit_ad_wallet.
create or replace function public.resume_ad_campaign(
  p_campaign_id uuid,
  p_actor_user_id uuid default null
)
returns table (ok boolean, status public.ad_campaign_status, balance_after_ngn integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.ad_campaigns%rowtype;
  v_debit record;
begin
  select * into c from public.ad_campaigns where id = p_campaign_id for update;
  if not found then
    raise exception 'resume_ad_campaign: no campaign %', p_campaign_id;
  end if;

  if c.status not in ('paused_by_employer', 'paused_insufficient_funds') then
    return query select false, c.status, null::integer; return;
  end if;

  if c.ends_on is not null and current_date > c.ends_on then
    update public.ad_campaigns set status = 'completed', updated_at = now() where id = c.id;
    return query select false, 'completed'::public.ad_campaign_status, null::integer; return;
  end if;

  if (c.total_budget_ngn - c.spent_ngn) < c.daily_rate_ngn then
    update public.ad_campaigns set status = 'completed', updated_at = now() where id = c.id;
    return query select false, 'completed'::public.ad_campaign_status, null::integer; return;
  end if;

  -- Already charged today? Then resuming costs nothing extra — go live without
  -- a second charge for the same day.
  if c.last_charged_on is not null and c.last_charged_on >= current_date then
    update public.ad_campaigns set status = 'active', updated_at = now() where id = c.id;
    return query select true, 'active'::public.ad_campaign_status, null::integer; return;
  end if;

  select * into v_debit from public.debit_ad_wallet(
    c.organization_id, c.daily_rate_ngn, 'campaign_charge', c.id, p_actor_user_id
  );

  if not v_debit.ok then
    -- Still cannot afford it. Stay paused, and make sure the state reflects
    -- WHY — an employer who paused deliberately and then could not resume
    -- needs to be told it is the money, not their earlier click.
    update public.ad_campaigns
       set status = 'paused_insufficient_funds', updated_at = now()
     where id = c.id;
    return query select false, 'paused_insufficient_funds'::public.ad_campaign_status,
                        v_debit.balance_after_ngn;
    return;
  end if;

  update public.ad_campaigns
     set status = 'active',
         spent_ngn = c.spent_ngn + c.daily_rate_ngn,
         last_charged_on = current_date,
         updated_at = now()
   where id = c.id;

  return query select true, 'active'::public.ad_campaign_status, v_debit.balance_after_ngn;
end;
$$;

-- Review decisions and deliberate pauses: plain state moves, no money.
create or replace function public.set_ad_campaign_review(
  p_campaign_id uuid,
  p_approve boolean,
  p_reviewer_id uuid,
  p_note text default null
)
returns public.ad_campaign_status
language plpgsql
security definer
set search_path = public
as $$
declare v_status public.ad_campaign_status;
begin
  update public.ad_campaigns
     set status = case when p_approve then 'paused_by_employer'::public.ad_campaign_status
                       else 'rejected'::public.ad_campaign_status end,
         reviewed_at = now(),
         reviewed_by = p_reviewer_id,
         review_note = p_note,
         updated_at = now()
   where id = p_campaign_id and status = 'pending_review'
  returning status into v_status;

  -- Approved campaigns land in `paused_by_employer`, NOT `active`. Approval
  -- says the ad is acceptable; it says nothing about whether the wallet can
  -- pay for it. Going live is `resume_ad_campaign`, which charges — so there
  -- is exactly one path from "not running" to "running", and it always costs
  -- money. Two paths would mean two places to forget the charge.
  return v_status;
end;
$$;

create or replace function public.pause_ad_campaign(p_campaign_id uuid)
returns public.ad_campaign_status
language plpgsql
security definer
set search_path = public
as $$
declare v_status public.ad_campaign_status;
begin
  update public.ad_campaigns
     set status = 'paused_by_employer', updated_at = now()
   where id = p_campaign_id and status in ('active', 'paused_insufficient_funds')
  returning status into v_status;
  return v_status;
end;
$$;

revoke all on function public.charge_ad_campaign_day(uuid, date) from public, anon, authenticated;
revoke all on function public.resume_ad_campaign(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_ad_campaign_review(uuid, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.pause_ad_campaign(uuid) from public, anon, authenticated;
grant execute on function public.charge_ad_campaign_day(uuid, date) to service_role;
grant execute on function public.resume_ad_campaign(uuid, uuid) to service_role;
grant execute on function public.set_ad_campaign_review(uuid, boolean, uuid, text) to service_role;
grant execute on function public.pause_ad_campaign(uuid) to service_role;
