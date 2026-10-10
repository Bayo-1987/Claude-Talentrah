-- 0250: Talent Directory subscription renewals get a claim, so two overlapping runs cannot both charge the saved card (audit 9 Oct, item "Talent Directory auto-renewal has no claim").
--
-- WHY. runTalentDirectorySubscriptionRenewalJob (src/lib/talent-directory/renewals.ts) selects every due subscription with a plain SELECT and calls chargeAuthorization with a fresh random reference for each. The
-- route has two entry points (GET for the cron, POST for a manual run) and the platform can fire a cron twice, so two runs can read the same due subscription before either has written anything, and BOTH charge the
-- organisation's card. Pass renewals closed exactly this hole in 0157 (renewal_claimed_at + a conditional UPDATE before any Paystack call; their own comment records "two concurrent runPassRenewalJob() calls charged
-- one due Pass twice"). This is the same fix for the other recurring charge, nothing new.
--
-- WHAT IT ADDS: one nullable column, public.talent_directory_subscriptions.renewal_claimed_at timestamptz. The job claims a due row with ONE conditional UPDATE (claimed_at is null or older than the staleness window,
-- and the row is still due) BEFORE it asks Paystack for anything; a run that does not win the claim skips the row. A claim older than the window is reclaimable, so a run that crashed mid-charge does not strand a
-- subscription. The job clears the claim when a row is resolved or deliberately left due for a retry.
--
-- GRANTS. None. The column is internal bookkeeping written and read with the service role only. talent_directory_subscriptions has had a column-level SELECT list for authenticated since 0231, so a column added later
-- is unreadable to the API roles until a migration grants it, and this one is not granted on purpose; tests/rls/payment-token-column-grants.test.ts lists it as restricted. No INSERT/UPDATE grant exists for these columns.
--
-- PER-REQUEST COST. Server work per request: none. Written only by the daily renewal job: one extra conditional UPDATE per due subscription.
--
-- ADDITIVE for the running app: no deployed code names the column. Applied BEFORE the code that uses it merges. Until it is applied nobody runs the renewal job by hand. The exact undo is
-- supabase/rollbacks/0250_td_renewal_claim.rollback.sql.

alter table public.talent_directory_subscriptions
  add column if not exists renewal_claimed_at timestamptz;

comment on column public.talent_directory_subscriptions.renewal_claimed_at is
  '0250: set atomically by the renewal job''s claim step immediately before it processes a due subscription, so two overlapping runs cannot both charge the saved card. A claim older than the staleness window (see CLAIM_STALENESS_MINUTES in src/lib/talent-directory/renewals.ts) is reclaimable; the job clears it when a row is resolved or left due for a retry. Service role only.';

-- Self-check: the column exists as designed and no API role can read or write it.
do $check$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'talent_directory_subscriptions' and column_name = 'renewal_claimed_at' and data_type = 'timestamp with time zone' and is_nullable = 'YES'
  ) then
    raise exception '0250: talent_directory_subscriptions.renewal_claimed_at is not a nullable timestamptz';
  end if;
  if exists (select 1 from public.talent_directory_subscriptions where renewal_claimed_at is not null) then
    raise exception '0250: a subscription already carries a renewal claim before the job that sets it exists';
  end if;
  if has_column_privilege('authenticated', 'public.talent_directory_subscriptions', 'renewal_claimed_at', 'select')
     or has_column_privilege('anon', 'public.talent_directory_subscriptions', 'renewal_claimed_at', 'select') then
    raise exception '0250: an API role can read renewal_claimed_at';
  end if;
  if has_column_privilege('authenticated', 'public.talent_directory_subscriptions', 'renewal_claimed_at', 'update')
     or has_column_privilege('authenticated', 'public.talent_directory_subscriptions', 'renewal_claimed_at', 'insert') then
    raise exception '0250: an API role can write renewal_claimed_at';
  end if;
end
$check$;
