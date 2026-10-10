-- 0228: activate a Talent Directory subscription atomically, at the moment payment is confirmed.
--
-- TWO BUGS, ONE FUNCTION.
--   (a) A subscription that ended and was not paid by a reusable card (so no renewal job ever touches it) stays status = 'active' for ever.
--       Every reader already checks expires_at > now() (talent_directory_search 0206, portfolio items 0135, contact requests 0155), so
--       access ends on time, but the stored status does not move. The partial unique index (one 'active' row per organisation, 0135) can
--       not use now() in its predicate, so the dead row keeps the organisation's one 'active' slot: the purchase action refuses a new
--       subscription, and if a payment ever reaches fulfilment for a pending row, activating it fails on the index AFTER Paystack took
--       the money, leaving the payment marked success and the subscription pending.
--   (b) expires_at was fixed when Subscribe was pressed, so every minute on the Paystack page, and any delay before the webhook, was taken
--       off the 30 days the employer paid for.
--
-- WHAT THIS ADDS: public.activate_talent_directory_subscription(p_subscription_id, p_auto_renew, p_authorization_code,
-- p_payment_transaction_id). In ONE transaction, serialised per organisation by a transaction-scoped advisory lock, it
--   1. refuses (returns activated = false, reason 'not_found' | 'not_pending' | 'plan_missing') unless the row exists and is still
--      'pending_payment', so a webhook redelivery or a double call is a no-op. The row is read once to find its organisation and AGAIN
--      under the lock: a row that has gone by then is 'not_found', one that is no longer pending is 'not_pending';
--   2. marks the organisation's OTHER 'active' rows 'lapsed' when they have ended AND are not waiting on an automatic renewal
--      (expires_at <= now() and auto_renew_status is distinct from 'active'). A row that is ended but still auto_renew_status = 'active'
--      is waiting for the renewal job (which extends it from its own expires_at): it is left alone, and it is why step 3 can refuse;
--   3. refuses (reason 'already_active') if any other 'active' row remains for the organisation (a running one, or one awaiting its
--      renewal). The caller records the payment as needs_refund; nothing is silently left pending;
--   4. activates the row: status 'active', started_at = now(), expires_at = now() + the plan's duration_days, next_renewal_date the UTC
--      date of that expiry when p_auto_renew (else null), authorization_code and payment_transaction_id recorded, renewal counters reset.
-- It returns (activated, reason, expires_at, plan_name). It never raises on those four outcomes, so the caller decides what to do.
--
-- WHO MAY CALL IT: SECURITY DEFINER with a pinned search_path (public, pg_temp: temporary objects are searched last, never first), EXECUTE revoked from public, anon and authenticated, granted to service_role
-- only (the Server Action and the payment callback run as the service role). A client can never activate a subscription.
--
-- WHAT IT DOES NOT TOUCH: no table, column, policy, index or existing function changes. The renewal job, the search function and every
-- other reader are unchanged. The click-time expires_at stays as a provisional value (the column is NOT NULL); activation overwrites it.
-- Additive, so it applies BEFORE the PR that calls it merges (supabase/migrations/README.md).

create or replace function public.activate_talent_directory_subscription(
  p_subscription_id uuid,
  p_auto_renew boolean,
  p_authorization_code text,
  p_payment_transaction_id uuid
)
returns table (activated boolean, reason text, expires_at timestamptz, plan_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub public.talent_directory_subscriptions%rowtype;
  v_plan public.talent_directory_plans%rowtype;
  v_expires timestamptz;
  v_rows integer;
begin
  select * into v_sub from public.talent_directory_subscriptions s where s.id = p_subscription_id;
  if not found then
    return query select false, 'not_found'::text, null::timestamptz, null::text;
    return;
  end if;

  -- One activation at a time per organisation: the checks below and the flip are only safe if nothing else for this organisation runs between them.
  perform pg_advisory_xact_lock(hashtextextended('talent_directory_subscription:' || v_sub.organization_id::text, 0));

  -- Read again under the lock: a concurrent call may have just activated it, or the row may be gone (an organisation deleted in between). After a
  -- failed SELECT INTO the record's fields are NULL, so a status comparison alone would be NULL, not true, and the code would run on past a missing row.
  select * into v_sub from public.talent_directory_subscriptions s where s.id = p_subscription_id for update;
  if not found then
    return query select false, 'not_found'::text, null::timestamptz, null::text;
    return;
  end if;
  if v_sub.status <> 'pending_payment' then
    return query select false, 'not_pending'::text, null::timestamptz, null::text;
    return;
  end if;

  select * into v_plan from public.talent_directory_plans p where p.id = v_sub.plan_id;
  if not found then
    return query select false, 'plan_missing'::text, null::timestamptz, null::text;
    return;
  end if;

  -- An ended row that is not waiting on an automatic renewal stops being 'active' (it already grants nothing: every reader checks expires_at).
  update public.talent_directory_subscriptions o
     set status = 'lapsed'
   where o.organization_id = v_sub.organization_id
     and o.id <> v_sub.id
     and o.status = 'active'
     and o.expires_at <= now()
     and o.auto_renew_status is distinct from 'active';

  -- Whatever is still 'active' is running, or is waiting for its renewal: it holds the one active slot.
  if exists (
    select 1 from public.talent_directory_subscriptions o
     where o.organization_id = v_sub.organization_id and o.id <> v_sub.id and o.status = 'active'
  ) then
    return query select false, 'already_active'::text, null::timestamptz, null::text;
    return;
  end if;

  v_expires := now() + make_interval(days => v_plan.duration_days);

  update public.talent_directory_subscriptions s
     set status = 'active',
         started_at = now(),
         expires_at = v_expires,
         auto_renew_status = case when p_auto_renew then 'active' else null end,
         next_renewal_date = case when p_auto_renew then (v_expires at time zone 'utc')::date else null end,
         authorization_code = p_authorization_code,
         payment_transaction_id = p_payment_transaction_id,
         renewal_attempt_count = 0,
         pending_renewal_reference = null
   where s.id = p_subscription_id
     and s.status = 'pending_payment';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    return query select false, 'not_pending'::text, null::timestamptz, null::text;
    return;
  end if;

  return query select true, 'activated'::text, v_expires, v_plan.name;
end;
$$;

comment on function public.activate_talent_directory_subscription(uuid, boolean, text, uuid) is
  'Activates a pending_payment Talent Directory subscription at payment confirmation: atomic per organisation, expires_at = now() + the plan duration, ended non-renewing rows lapsed, one active row per organisation. service_role only. See 0228''s header.';

revoke all on function public.activate_talent_directory_subscription(uuid, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.activate_talent_directory_subscription(uuid, boolean, text, uuid) to service_role;
