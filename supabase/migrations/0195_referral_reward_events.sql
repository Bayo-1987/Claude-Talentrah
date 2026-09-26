-- send-462 — the outbox `grant_referral_reward` needs to eventually cause a
-- real notification (email + in-app) to go out.
--
-- ── WHY AN OUTBOX TABLE, NOT SOMETHING ALREADY IN THIS REPO ────────────────
--
-- `grant_referral_reward` (0163) runs inside a Postgres trigger
-- (`handle_new_user`, `check_and_activate_referral`) and cannot make an HTTP
-- call to Resend — SQL has no such capability, and nothing in this repo
-- pretends otherwise. Checked for an existing "trigger needs to eventually
-- run an HTTP-capable job" mechanism before building a new one:
-- `application_stage_events` (the hired-stage trigger) is read only by the
-- tracker page itself, never polled by a cron; the proactive match alert
-- (0131) LOOKS like the same shape but isn't — it's computed entirely in the
-- app-layer job-ingest cron, never from a DB trigger, so it never needed an
-- outbox. Nothing in this repo already solves "a plpgsql trigger needs a
-- later HTTP-capable job to notice what it did" — this table is that, kept
-- as small as the problem: one row per actual grant, one nullable
-- `notified_at` stamp, service-role only, the same shape
-- `email_preferences`/`proactive_match_alerts` already use for a table
-- nothing but a cron and service-role code ever touches.
--
-- ONLY INSERTED ON AN ACTUAL GRANT, NOT ON EVERY CALL. The 30-day/10-referral
-- cap check in `grant_referral_reward` already returns early with no credits
-- moved — this insert is added AFTER that check and AFTER the credits
-- actually move, so a capped call produces no event row and therefore no
-- notification. A referrer who is capped keeps their in-app dashboard as the
-- only signal, same as today; this send does not change that.
--
-- `referred_user_id` is captured via the existing `update ... returning`
-- rather than a second query — `referrals.referred_user_id` was already one
-- column away.

create table public.referral_reward_events (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals(id) on delete cascade,
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_user_id uuid not null references public.profiles(id) on delete cascade,
  credits_granted integer not null,
  reason public.credit_reason not null,
  created_at timestamptz not null default now(),
  -- Set once, by the cron that actually sends the notification. NULL means
  -- "not yet notified" — the same "stamp only after a successful send" rule
  -- digest_last_sent_at and reminder_sent_at both already follow, so a
  -- failed send retries on the next run instead of being silently dropped.
  notified_at timestamptz
);

comment on table public.referral_reward_events is
  'One row per actual referral-reward credit grant (send-462) — the outbox grant_referral_reward writes to since a DB trigger cannot call Resend directly. Read by /api/admin/send-referral-reward-notifications, which stamps notified_at after a successful send. Service-role only.';

alter table public.referral_reward_events enable row level security;

-- No policies at all, deliberately — service_role only, same treatment as
-- email_preferences and proactive_match_alerts: nothing here is a value a
-- client should ever read or write directly.
revoke all on public.referral_reward_events from anon, authenticated;

-- Mirrors email_preferences_digest_idx / mentorship_sessions_reminder_pending_idx
-- — a partial index on the exact WHERE clause the cron's own work-list query
-- runs.
create index referral_reward_events_pending_idx
  on public.referral_reward_events (created_at)
  where notified_at is null;

-- Re-defined to add exactly one thing: on the path where credits actually
-- move, also record that this grant happened. The cap-check early return
-- above it, grant_credits_atomic call, and the referrals update are
-- byte-identical to 0163's own definition — confirmed against production via
-- pg_get_functiondef before writing this migration, the same discipline
-- 0092's own header describes for touching this same function.
create or replace function public.grant_referral_reward(
  p_referral_id uuid,
  p_referrer_id uuid,
  p_amount integer,
  p_reason public.credit_reason
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referred_user_id uuid;
begin
  if public.count_rewarded_referrals_last_30d(p_referrer_id, p_referral_id) >= 10 then
    return;
  end if;

  perform public.grant_credits_atomic(p_referrer_id, p_amount, p_reason, p_referral_id);

  update public.referrals
  set reward_credits_referrer = reward_credits_referrer + p_amount
  where id = p_referral_id
  returning referred_user_id into v_referred_user_id;

  insert into public.referral_reward_events (referral_id, referrer_id, referred_user_id, credits_granted, reason)
  values (p_referral_id, p_referrer_id, v_referred_user_id, p_amount, p_reason);
end;
$$;

revoke all on function public.grant_referral_reward(uuid, uuid, integer, public.credit_reason) from public;
revoke all on function public.grant_referral_reward(uuid, uuid, integer, public.credit_reason) from anon;
revoke all on function public.grant_referral_reward(uuid, uuid, integer, public.credit_reason) from authenticated;
grant execute on function public.grant_referral_reward(uuid, uuid, integer, public.credit_reason) to service_role, postgres;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'referral_reward_events'
  ) then
    raise exception 'referral_reward_events was not created';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'referral_reward_events'
      and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'referral_reward_events must be service_role-only — anon/authenticated still hold a grant';
  end if;
end $$;
