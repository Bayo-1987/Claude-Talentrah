-- 0159 — Make credit_pack/pass fulfillment atomic (send-228, Critical: real money).
--
-- ---------------------------------------------------------------------------
-- What was wrong
-- ---------------------------------------------------------------------------
-- src/lib/billing/fulfill.ts's fulfillPayment() did:
--
--     read  payment_transactions.status              -- "pending"
--     check status !== "pending"                     -- passes
--     ... verify with Paystack, determine channel ...
--     grant credits / insert user_passes row          -- the money-moving step
--     update payment_transactions set status = "success"   -- unconditional write
--
-- The read and the eventual write are two separate statements with no lock
-- held between them — a check-then-act race, not an atomic gate. This is the
-- exact bug shape CLAUDE.md documents as the worst class of bug this codebase
-- has shipped: spendCredits looked correct for months and let two concurrent
-- spends both succeed at balance == cost, because apply_credit_ledger_entry
-- overwrites profiles.credits_balance ABSOLUTELY rather than decrementing it.
-- 0035 fixed that with spend_credits_atomic — a single conditional
-- UPDATE ... WHERE balance >= amount. This is the same fix shape, applied on
-- the fulfillment side instead of the spend side.
--
-- Concrete failure scenario, not hypothetical: 0043's own work already
-- assumes and designs around Paystack retrying a webhook delivery it didn't
-- get a clean 2xx response for. Two near-simultaneous deliveries of the same
-- webhook both read status = "pending", both pass the check, both fulfil. A
-- customer who paid once for a credit pack or a Pass gets it granted twice —
-- real revenue leakage.
--
-- ad_wallet_topup does NOT need this fix — confirmed directly, not assumed:
-- credit_ad_wallet dedupes on ad_wallet_ledger_topup_reference_idx, a UNIQUE
-- partial index on paystack_reference (0046), which is real and still in
-- place. mentor_session and talent_directory_subscription already carry
-- their own `.eq("status", "pending_payment")` conditional UPDATE on their
-- OWN row, which is already race-safe for that row's state transition (no
-- separate ledger/grant step exists for either — the thing being sold was
-- already reserved before payment). Scoped to credit_pack and pass only, per
-- the two branches that actually have this gap.
--
-- ---------------------------------------------------------------------------
-- The fix
-- ---------------------------------------------------------------------------
-- Two new functions.
--
-- grant_credits_atomic() mirrors spend_credits_atomic's exact technique for
-- the grant side: a single UPDATE does a RELATIVE increment
-- (credits_balance = credits_balance + p_amount, never a value read in JS
-- and computed outside the database) and RETURNs the post-increment balance
-- under the row's own lock, so two concurrent grants to the same user
-- serialize correctly instead of one clobbering the other via the trigger's
-- absolute overwrite. Unlike spend_credits_atomic there is no failure
-- condition to check (a grant cannot be "insufficient"), so this always
-- succeeds for an existing user — the atomicity is entirely in the RELATIVE
-- update, same as the fix for the spend side. Written as its own reusable
-- function (not inlined into the fulfillment function below) because
-- grantCredits() in src/lib/credits/spend.ts has this identical race on its
-- other callers (referral payouts, free-trial grants) — a separate, lower-
-- severity fix (send-229) generalizes onto this exact function rather than
-- building a second one.
--
-- fulfill_credit_pack_or_pass() does the status CHECK and the fulfilment
-- WRITE — including the actual grant — in one function call, which runs as
-- one implicit transaction: the conditional UPDATE on payment_transactions
-- (WHERE status = 'pending') claims the row exactly once under Postgres's own
-- row lock, and the credit grant / user_passes insert for the winning caller
-- happens inside that SAME transaction. If anything inside this function
-- raises after the claim, Postgres rolls back the whole function invocation
-- — including the claim itself — so a mid-grant failure leaves the row back
-- at 'pending' for the next webhook redelivery to retry, rather than stuck
-- 'success' with nothing granted. This is deliberately safer than the
-- ordering the original JS code used (grant-then-flip, to avoid exactly that
-- stuck state) while also closing the concurrency race the JS ordering could
-- not: one Postgres transaction gives both properties at once, which two
-- separate application-level statements cannot.
--
-- Looks up credit_packs/passes internally by product_id rather than taking
-- them as arguments, so the only inputs are things ONLY known post-Paystack-
-- verification (channel, authorization_code) — everything else this function
-- needs is already on the row it just claimed.
--
-- Returns structured data (product_type, credits_granted, pass_name) rather
-- than a formatted "5,000 credits" string — number formatting
-- (toLocaleString()) stays in TypeScript, where it already lives for every
-- other product type's receipt copy.
--
-- service_role only, same reasoning as 0035: called from server code that has
-- already verified the payment with Paystack, and granting it to
-- `authenticated` would let a signed-in user fulfil an arbitrary transaction
-- id directly.

create or replace function public.grant_credits_atomic(
  p_user_id uuid,
  p_amount integer,
  p_reason public.credit_reason,
  p_related_entity_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_balance integer;
begin
  if p_amount <= 0 then
    -- A zero or negative "grant" would be a spend wearing a grant's clothes.
    raise exception 'grant_credits_atomic: amount must be positive, got %', p_amount;
  end if;

  update public.profiles p
     set credits_balance = p.credits_balance + p_amount,
         updated_at = now()
   where p.id = p_user_id
  returning p.credits_balance into v_new_balance;

  if v_new_balance is null then
    raise exception 'grant_credits_atomic: no profile found for user %', p_user_id;
  end if;

  insert into public.credit_ledger (user_id, delta, reason, related_entity_id, balance_after)
  values (p_user_id, p_amount, p_reason, p_related_entity_id, v_new_balance);

  return v_new_balance;
end;
$$;

revoke all on function public.grant_credits_atomic(uuid, integer, public.credit_reason, uuid) from public;
revoke all on function public.grant_credits_atomic(uuid, integer, public.credit_reason, uuid) from anon;
revoke all on function public.grant_credits_atomic(uuid, integer, public.credit_reason, uuid) from authenticated;
grant execute on function public.grant_credits_atomic(uuid, integer, public.credit_reason, uuid) to service_role;

create or replace function public.fulfill_credit_pack_or_pass(
  p_transaction_id uuid,
  p_channel text,
  p_authorization_code text default null
)
returns table (
  claimed boolean,
  product_type public.payment_product_type,
  credits_granted integer,
  pass_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction public.payment_transactions;
  v_pack public.credit_packs;
  v_pass public.passes;
  v_auto_renew boolean;
  v_expires_at timestamptz;
begin
  update public.payment_transactions t
     set status = 'success',
         channel = p_channel,
         authorization_code = p_authorization_code
   where t.id = p_transaction_id
     and t.status = 'pending'
     and t.product_type in ('credit_pack', 'pass')
  returning t.* into v_transaction;

  -- Either already processed by a concurrent/earlier call, doesn't exist, or
  -- isn't a credit_pack/pass row (every other product_type keeps its own
  -- handling in fulfill.ts, untouched by this migration).
  if v_transaction.id is null then
    return query select false, null::public.payment_product_type, null::integer, null::text;
    return;
  end if;

  if v_transaction.product_type = 'credit_pack' then
    select * into v_pack from public.credit_packs where id = v_transaction.product_id;
    if v_pack.id is not null then
      perform public.grant_credits_atomic(
        v_transaction.user_id, v_pack.credits, 'purchase'::public.credit_reason, v_transaction.id
      );
      return query select true, v_transaction.product_type, v_pack.credits, null::text;
      return;
    end if;
    -- product_id pointed nowhere real — claimed (so no other caller retries
    -- it), nothing to grant. Matches the original code's own silent-no-op
    -- behaviour when the looked-up row came back empty.
    return query select true, v_transaction.product_type, null::integer, null::text;
    return;
  end if;

  -- product_type = 'pass' (the only other value the WHERE clause admits)
  select * into v_pass from public.passes where id = v_transaction.product_id;
  if v_pass.id is not null then
    v_expires_at := now() + (v_pass.duration_days || ' days')::interval;
    v_auto_renew := p_channel = 'card' and p_authorization_code is not null;

    insert into public.user_passes (
      user_id, pass_id, expires_at, payment_method, auto_renew,
      auto_renew_status, next_renewal_date, authorization_code,
      payment_transaction_id, status
    ) values (
      v_transaction.user_id, v_transaction.product_id, v_expires_at,
      case when p_channel = 'card' then 'card' else 'mobile_money' end::public.pass_payment_method,
      v_auto_renew,
      case when v_auto_renew then 'active' else null end::public.pass_auto_renew_status,
      case when v_auto_renew then v_expires_at::date else null end,
      p_authorization_code, v_transaction.id, 'active'
    );
    return query select true, v_transaction.product_type, null::integer, v_pass.name;
    return;
  end if;

  return query select true, v_transaction.product_type, null::integer, null::text;
end;
$$;

revoke all on function public.fulfill_credit_pack_or_pass(uuid, text, text) from public;
revoke all on function public.fulfill_credit_pack_or_pass(uuid, text, text) from anon;
revoke all on function public.fulfill_credit_pack_or_pass(uuid, text, text) from authenticated;
grant execute on function public.fulfill_credit_pack_or_pass(uuid, text, text) to service_role;
