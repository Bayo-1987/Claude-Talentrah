-- ROLLBACK for 0228 (activate_talent_directory_subscription). Not a migration: it is the exact undo, kept beside the file it undoes so it is reviewed in the same diff. Run it as `postgres`
-- in the SQL Editor, in ONE transaction (it is written to be). To keep what the schema ledger says honest, record it as a NEW migration (do not delete 0228's ledger row).
-- `supabase/rollbacks/` is outside supabase/migrations, so neither the migration-numbering check nor `supabase db push` ever sees it.
--
-- ORDER MATTERS. The code that confirms a Talent Directory payment (src/lib/billing/fulfill.ts, in the 0228 code PR) CALLS this function. Dropping it while that code is deployed makes
-- every subscription payment confirmation throw AFTER Paystack has taken the money. So: revert or take down that code first, then run this. The guard below only catches the case it can
-- see from here: a payment that may be in flight (a subscription still pending_payment and created in the last 60 minutes) stops the rollback.
--
-- WHAT IT CHANGES: the function is dropped; nothing else. No table, column, policy, index or other function was touched by 0228, and no row is written or deleted here. Subscriptions
-- already activated by it stay activated (their stored expires_at stays the one it set).

begin;

do $guard$
begin
  if pg_catalog.to_regprocedure('public.activate_talent_directory_subscription(uuid, boolean, text, uuid)') is null then
    raise exception '0228 rollback: public.activate_talent_directory_subscription(uuid, boolean, text, uuid) is not there; nothing to undo';
  end if;
  if exists (
    select 1 from public.talent_directory_subscriptions s
     where s.status = 'pending_payment' and s.created_at > now() - interval '60 minutes'
  ) then
    raise exception '0228 rollback: a subscription payment may be in flight (a pending_payment subscription created in the last 60 minutes); revert the code that calls the function first, wait, and run this again';
  end if;
end
$guard$;

drop function public.activate_talent_directory_subscription(uuid, boolean, text, uuid);

do $check$
begin
  if pg_catalog.to_regprocedure('public.activate_talent_directory_subscription(uuid, boolean, text, uuid)') is not null then
    raise exception '0228 rollback: the function is still there after the drop';
  end if;
end
$check$;

commit;
