-- ROLLBACK for 0247 (payment_transactions.reconcile_checked_at, reconcile_result, reconcile_attempts). Not a migration: it is the exact undo, kept beside the file it undoes so it is reviewed in the same diff.
-- Run it as `postgres` in the SQL Editor (it is one transaction). To keep what the schema ledger says honest, record it as a NEW migration (do not delete 0247's ledger row).
-- `supabase/rollbacks/` is outside supabase/migrations, so neither the migration-numbering check nor `supabase db push` ever sees it.
--
-- WHAT IT CHANGES: the three columns, their two check constraints (dropped with the columns) and what they hold are gone. What the check recorded is lost; no payment, status, credit or receipt is touched.
-- ORDER: deploy the code that reads the columns away first (or turn the daily route off); the Finance page and the check name these columns and would fail without them.
begin;

alter table public.payment_transactions
  drop column if exists reconcile_checked_at,
  drop column if exists reconcile_result,
  drop column if exists reconcile_attempts;

commit;
