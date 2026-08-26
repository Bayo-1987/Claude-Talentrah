-- 0046 — Employer ad wallets: prepaid balance, append-only ledger, atomic debit.
--
-- Design brief: docs/employer-billing-plan.md. Read §3 (atomicity), §4
-- (pause at zero) and §7 (the four decisions) before changing anything here.
--
-- ---------------------------------------------------------------------------
-- Units: whole naira, matching payment_transactions.amount
-- ---------------------------------------------------------------------------
-- A DEVIATION FROM THE PLAN DOC, made deliberately after reading the schema.
-- The brief proposed `balance_kobo bigint` for precision. But
-- `payment_transactions.amount` is `integer` in whole naira (see
-- renewals.ts: `amount: pass.price_ngn`), and `passes.price_ngn` likewise.
-- Introducing a second money unit alongside an existing one is a classic
-- money bug — every boundary between them becomes a place to forget a factor
-- of 100. Consistency beats theoretical precision here: flat-rate campaigns
-- are priced in whole naira, there is no sub-naira concept anywhere in the
-- product, and integer tops out around ₦2.1bn.
--
-- ---------------------------------------------------------------------------
-- The ledger is the record; the balance is a cache
-- ---------------------------------------------------------------------------
-- Same relationship as credit_ledger / profiles.credits_balance, and for the
-- same reason: a running total you cannot reconstruct is a number you cannot
-- audit. Every movement writes a ledger row carrying `balance_after_ngn`, and
-- that value always comes from what the UPDATE actually returned — never from
-- a figure computed in application code. 0035's post-mortem is the argument:
-- once ledger and cache diverge under contention, the ledger stops being able
-- to explain the balance.

create type public.ad_wallet_reason as enum (
  'topup',            -- employer funded the wallet (Paystack confirmed)
  'campaign_charge',  -- a campaign drew down
  'admin_adjustment', -- support correction; deliberately auditable
  'reversal'          -- a charge undone (NOT a cash refund — see §7.1)
);

create table if not exists public.ad_wallets (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- Explicit, not implied NGN. §5: a top-up's rail and an employer's currency
  -- are properties of the data, so a future USD wallet is a row rather than a
  -- migration. A wallet is single-currency by design — conversion at spend
  -- time is a pricing decision nobody has made.
  currency text not null default 'NGN',
  balance_ngn integer not null default 0,
  -- §7.3: the low-balance warning fires at 20% of the LAST top-up remaining,
  -- so the threshold has to be remembered per wallet. Percentage rather than
  -- an absolute figure because it scales with how the employer actually uses
  -- the product; "one day's spend" would need a spend rate, and v1 has no
  -- metering.
  last_topup_ngn integer,
  low_balance_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ad_wallets_balance_non_negative check (balance_ngn >= 0)
);

create table if not exists public.ad_wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Signed: positive credits, negative debits. Sums to the balance, which is
  -- what makes reconciliation a query rather than an investigation.
  delta_ngn integer not null,
  reason public.ad_wallet_reason not null,
  balance_after_ngn integer not null,
  related_entity_id uuid,
  -- Set on top-ups. The unique index below is what makes crediting idempotent
  -- against Paystack webhook redelivery, which is not hypothetical — Paystack
  -- retries.
  paystack_reference text,
  -- Who acted. §7.4 allows owner AND admin to spend; recording the actor is
  -- what makes that widening reviewable after the fact.
  actor_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ad_wallet_ledger_delta_non_zero check (delta_ngn <> 0)
);

create index if not exists ad_wallet_ledger_org_idx
  on public.ad_wallet_ledger (organization_id, created_at desc);

create unique index if not exists ad_wallet_ledger_topup_reference_idx
  on public.ad_wallet_ledger (paystack_reference)
  where paystack_reference is not null;

-- ---------------------------------------------------------------------------
-- RLS: employers READ their own wallet, and write nothing
-- ---------------------------------------------------------------------------
-- balance_ngn is the highest-value column in this schema. Per the class this
-- repo has now hit five times (0028, 0030, 0031, 0041, 0045): a row policy
-- does not restrict columns, and Supabase grants UPDATE ON ALL TABLES to
-- `authenticated` by default. So the grant is revoked outright with NO column
-- grant back — there is no column here a client has any business writing.
alter table public.ad_wallets enable row level security;
alter table public.ad_wallet_ledger enable row level security;

create policy "org members read their own ad wallet"
  on public.ad_wallets for select
  using (public.is_org_member(organization_id));

create policy "org members read their own ad wallet ledger"
  on public.ad_wallet_ledger for select
  using (public.is_org_member(organization_id));

revoke insert, update, delete on public.ad_wallets from anon, authenticated;
revoke insert, update, delete on public.ad_wallet_ledger from anon, authenticated;

-- ---------------------------------------------------------------------------
-- debit_ad_wallet — one statement, or it is not a gate
-- ---------------------------------------------------------------------------
-- Modelled directly on spend_credits_atomic (0035), which exists because the
-- read-then-write version looked correct for months. Reproduced here before
-- writing this, against a throwaway wallet: two concurrent ₦5,000 debits on a
-- ₦5,000 balance both succeeded — ₦10,000 of charges delivered, ₦5,000 taken,
-- ₦5,000 served free.
--
-- Three properties, none optional:
--   * the decrement is RELATIVE (balance_ngn - p_amount_ngn), never a number
--     computed outside the database;
--   * the affordability check and the write are ONE statement, so a concurrent
--     debit blocks on the row lock and re-evaluates against what the winner
--     already wrote;
--   * the ledger row is written from the balance the UPDATE returned.
--
-- service_role only. p_organization_id is an argument, so granting this to
-- `authenticated` would turn that argument into a forgeable authorisation —
-- the same reasoning as 0034 and 0035. Caller-side role enforcement (§7.4,
-- owner or admin) happens in the Server Action that has the session.
create or replace function public.debit_ad_wallet(
  p_organization_id uuid,
  p_amount_ngn integer,
  p_reason public.ad_wallet_reason default 'campaign_charge',
  p_related_entity_id uuid default null,
  p_actor_user_id uuid default null
)
returns table (ok boolean, balance_after_ngn integer, low_balance boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance integer;
  v_last_topup integer;
begin
  if p_amount_ngn <= 0 then
    -- A zero or negative debit is a credit wearing a debit's clothes.
    raise exception 'debit_ad_wallet: amount must be positive, got %', p_amount_ngn;
  end if;

  update public.ad_wallets w
     set balance_ngn = w.balance_ngn - p_amount_ngn,
         updated_at  = now()
   where w.organization_id = p_organization_id
     and w.balance_ngn >= p_amount_ngn
  returning w.balance_ngn, w.last_topup_ngn into v_new_balance, v_last_topup;

  if v_new_balance is null then
    -- No row updated: no wallet, or the balance moved under us while a
    -- concurrent debit held the lock. Either way this is the affordability
    -- answer — §4's "can we afford it?" is this returning false, never a
    -- separate check.
    select w.balance_ngn into v_new_balance
      from public.ad_wallets w where w.organization_id = p_organization_id;
    return query select false, coalesce(v_new_balance, 0), false;
    return;
  end if;

  insert into public.ad_wallet_ledger
    (organization_id, delta_ngn, reason, balance_after_ngn, related_entity_id, actor_user_id)
  values
    (p_organization_id, -p_amount_ngn, p_reason, v_new_balance, p_related_entity_id, p_actor_user_id);

  -- §7.3: 20% of the last top-up remaining. Evaluated on the debit that
  -- crosses the line rather than on a schedule — no polling job.
  return query select
    true,
    v_new_balance,
    (v_last_topup is not null and v_new_balance <= (v_last_topup * 20 / 100));
end;
$$;

-- ---------------------------------------------------------------------------
-- credit_ad_wallet — idempotent on the Paystack reference
-- ---------------------------------------------------------------------------
-- Paystack retries webhooks. Crediting twice for one payment is the mirror of
-- the debit race and just as real, so the reference carries a unique index and
-- a repeat call is a no-op that returns the balance unchanged rather than an
-- error — a redelivered webhook is normal traffic, not a fault.
create or replace function public.credit_ad_wallet(
  p_organization_id uuid,
  p_amount_ngn integer,
  p_reason public.ad_wallet_reason default 'topup',
  p_paystack_reference text default null,
  p_actor_user_id uuid default null
)
returns table (ok boolean, balance_after_ngn integer, already_applied boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance integer;
  v_existing integer;
begin
  if p_amount_ngn <= 0 then
    raise exception 'credit_ad_wallet: amount must be positive, got %', p_amount_ngn;
  end if;

  if p_paystack_reference is not null then
    select l.balance_after_ngn into v_existing
      from public.ad_wallet_ledger l
     where l.paystack_reference = p_paystack_reference;
    if v_existing is not null then
      -- Already credited. Report the CURRENT balance, not the historical one:
      -- the caller wants to know where the wallet stands now.
      select w.balance_ngn into v_new_balance
        from public.ad_wallets w where w.organization_id = p_organization_id;
      return query select true, coalesce(v_new_balance, 0), true;
      return;
    end if;
  end if;

  insert into public.ad_wallets (organization_id, balance_ngn)
  values (p_organization_id, p_amount_ngn)
  on conflict (organization_id) do update
    set balance_ngn = public.ad_wallets.balance_ngn + p_amount_ngn,
        updated_at  = now()
  returning balance_ngn into v_new_balance;

  if p_reason = 'topup' then
    -- Reset the low-balance signal: a fresh top-up sets a new baseline, and
    -- the employer should be warned again when they approach the line.
    update public.ad_wallets
       set last_topup_ngn = p_amount_ngn, low_balance_notified_at = null
     where organization_id = p_organization_id;
  end if;

  insert into public.ad_wallet_ledger
    (organization_id, delta_ngn, reason, balance_after_ngn, paystack_reference, actor_user_id)
  values
    (p_organization_id, p_amount_ngn, p_reason, v_new_balance, p_paystack_reference, p_actor_user_id);

  return query select true, v_new_balance, false;
end;
$$;

revoke all on function public.debit_ad_wallet(uuid, integer, public.ad_wallet_reason, uuid, uuid) from public, anon, authenticated;
grant execute on function public.debit_ad_wallet(uuid, integer, public.ad_wallet_reason, uuid, uuid) to service_role;

revoke all on function public.credit_ad_wallet(uuid, integer, public.ad_wallet_reason, text, uuid) from public, anon, authenticated;
grant execute on function public.credit_ad_wallet(uuid, integer, public.ad_wallet_reason, text, uuid) to service_role;
