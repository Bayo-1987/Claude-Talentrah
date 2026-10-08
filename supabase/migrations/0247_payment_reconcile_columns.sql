-- 0247: payment_transactions records what a check with Paystack found, beside the row (Plan B: stale pending payments).
--
-- WHY. A payment row that is still `pending` after a day is either a checkout the buyer abandoned or a real charge whose webhook never arrived (the second means someone paid and did not get what they bought).
-- Nothing today tells the two apart: the Finance badge counted every pending row forever, and fulfillPayment marks a row `failed` on ANY answer from Paystack that is not `success`, so asking it about an abandoned
-- checkout would close a row the buyer can still pay. The daily check (src/lib/billing/reconcile.ts, a later PR) therefore asks Paystack FIRST, calls fulfillPayment only on `success`, and writes its finding in these
-- columns. `status` stays exactly as it is for everything the check does not fulfil.
--
-- WHAT IT ADDS (three columns on public.payment_transactions, nothing else):
--   reconcile_checked_at  timestamptz            when the check last asked Paystack about this row (null: never checked)
--   reconcile_result      text, a closed list    what it found: error, fulfilled_by_check, paystack_abandoned, paystack_failed, paystack_not_found, paystack_reversed, paystack_unsettled
--                                                (paystack_unsettled = Paystack still has it in a non-final state, or answered with a status this code does not know)
--   reconcile_attempts    integer, default 0     how many checks ended in `error` (Paystack unreachable or answered badly); five stop the retries
-- Why not a new `abandoned` status: every reader of `status` would have to learn it and fulfillPayment's "not pending means done" rule, the most dangerous function in the app, would have to change for a label.
--
-- GRANTS. None. The columns are internal bookkeeping read and written with the service role by the check and the Finance page; no API role holds a column privilege on them (payment_transactions has had its
-- column-level SELECT list since 0231, so a column added later is unreadable to authenticated and anon until a migration grants it, and no INSERT/UPDATE since 0151). tests/rls/payment-token-column-grants.test.ts
-- lists the three as restricted ON PURPOSE.
--
-- PER-REQUEST COST. Server work per request: none. Three nullable/defaulted columns on a table that is written once per purchase; nothing reads them on a user request. ADDITIVE for the running app: no code reads
-- them yet, so it is applied BEFORE the code that uses it merges. The exact undo is supabase/rollbacks/0247_payment_reconcile_columns.rollback.sql.

alter table public.payment_transactions
  add column if not exists reconcile_checked_at timestamptz,
  add column if not exists reconcile_result text,
  add column if not exists reconcile_attempts integer not null default 0,
  add constraint payment_transactions_reconcile_result_check
    check (reconcile_result is null or reconcile_result in ('error', 'fulfilled_by_check', 'paystack_abandoned', 'paystack_failed', 'paystack_not_found', 'paystack_reversed', 'paystack_unsettled')),
  add constraint payment_transactions_reconcile_attempts_check
    check (reconcile_attempts >= 0);

comment on column public.payment_transactions.reconcile_checked_at is '0247: when the daily Paystack check last asked about this row. Null: never checked. Service role only.';
comment on column public.payment_transactions.reconcile_result is '0247: what the last check found (closed list). Never changes status; only fulfilled_by_check comes with a fulfilled payment. Service role only.';
comment on column public.payment_transactions.reconcile_attempts is '0247: checks that ended in error (Paystack unreachable or answered badly). Five stop the retries. Service role only.';

-- Self-check: the migration fails (and nothing is kept) unless the three columns exist as designed and no API role can read or write them.
do $check$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'payment_transactions'
         and column_name in ('reconcile_checked_at', 'reconcile_result', 'reconcile_attempts')) <> 3 then
    raise exception '0247: payment_transactions does not have the three reconcile columns';
  end if;
  if exists (select 1 from public.payment_transactions where reconcile_result is not null or reconcile_checked_at is not null or reconcile_attempts <> 0) then
    raise exception '0247: a payment row already carries a reconcile value before the check exists';
  end if;
  if has_column_privilege('authenticated', 'public.payment_transactions', 'reconcile_result', 'select')
     or has_column_privilege('anon', 'public.payment_transactions', 'reconcile_result', 'select')
     or has_column_privilege('authenticated', 'public.payment_transactions', 'reconcile_checked_at', 'select')
     or has_column_privilege('anon', 'public.payment_transactions', 'reconcile_checked_at', 'select')
     or has_column_privilege('authenticated', 'public.payment_transactions', 'reconcile_attempts', 'select')
     or has_column_privilege('anon', 'public.payment_transactions', 'reconcile_attempts', 'select') then
    raise exception '0247: an API role can read a reconcile column';
  end if;
  if has_column_privilege('authenticated', 'public.payment_transactions', 'reconcile_result', 'update')
     or has_column_privilege('authenticated', 'public.payment_transactions', 'reconcile_checked_at', 'update')
     or has_column_privilege('authenticated', 'public.payment_transactions', 'reconcile_attempts', 'update')
     or has_column_privilege('authenticated', 'public.payment_transactions', 'reconcile_result', 'insert') then
    raise exception '0247: an API role can write a reconcile column';
  end if;
end
$check$;
