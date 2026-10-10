-- ROLLBACK for 0256 (applicant_messages, claim_applicant_message, organizations.premium_until). Not a migration: it is the exact undo, kept beside the file it undoes so it is reviewed in the same diff.
-- Run it as `postgres` in the SQL Editor (one transaction). To keep what the schema ledger says honest, record it as a NEW migration (do not delete 0256's ledger row). `supabase/rollbacks/` is outside
-- supabase/migrations, so neither the migration-numbering check nor `supabase db push` ever sees it.
--
-- WHAT IT CHANGES: the message log (and every row in it), the claim function and the premium_until column (and any date set on it) are dropped and the organizations INSERT policy returns to 0120's text; nothing else. ORDER: deploy the code that sends messages and reads
-- premium_until away first (or the page that sends would fail); the 20-per-day limit and the audit of what was sent are gone with the table.
begin;

drop function if exists public.claim_applicant_message(uuid, uuid, uuid, uuid, text, text, text, integer);
drop table if exists public.applicant_messages;

-- Put the organizations INSERT policy back exactly as 0120 defined it (it names premium_until, so it must go before the column does).
drop policy if exists "authenticated users can create an organization" on public.organizations;
create policy "authenticated users can create an organization"
  on public.organizations
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and verified = false
    and cac_confirmed_at is null
    and cac_confirmed_by is null
  );

alter table public.organizations drop column if exists premium_until;

commit;
