-- ROLLBACK for 0250 (talent_directory_subscriptions.renewal_claimed_at). Not a migration: it is the exact undo, kept beside the file it undoes so it is reviewed in the same diff.
-- Run it as `postgres` in the SQL Editor (one transaction). To keep what the schema ledger says honest, record it as a NEW migration (do not delete 0250's ledger row). `supabase/rollbacks/` is outside
-- supabase/migrations, so neither the migration-numbering check nor `supabase db push` ever sees it.
--
-- WHAT IT CHANGES: the column and any claim it holds are dropped; nothing else. ORDER: deploy the code that sets and reads the claim away first, or stop the renewal route; the job names this column and would
-- fail without it. After it, overlapping renewal runs can charge a card twice again, so nobody runs the job by hand.
begin;

alter table public.talent_directory_subscriptions
  drop column if exists renewal_claimed_at;

commit;
