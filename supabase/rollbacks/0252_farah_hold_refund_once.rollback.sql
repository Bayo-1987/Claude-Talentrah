-- ROLLBACK for 0252 (credit_ledger_farah_hold_refund_once_idx). Not a migration: it is the exact undo, kept beside the file it undoes so it is reviewed in the same diff.
-- Run it as `postgres` in the SQL Editor (one transaction). To keep what the schema ledger says honest, record it as a NEW migration (do not delete 0252's ledger row). `supabase/rollbacks/` is outside
-- supabase/migrations, so neither the migration-numbering check nor `supabase db push` ever sees it.
--
-- WHAT IT CHANGES: the index is dropped; nothing else. After it, a second refund for the same Farah hold is no longer refused by the database, so the paid-hold sweep (if deployed) must be turned off first
-- or it could refund a hold twice when two sweeps overlap. No row is touched.
begin;

drop index if exists public.credit_ledger_farah_hold_refund_once_idx;

commit;
