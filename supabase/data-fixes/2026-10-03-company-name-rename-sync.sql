-- 2026-10-03: the Growth Marketer posting's company_name follows its organisation's rename ("Talentrah Portal" -> "Talentrah").
--
-- A ONE-OFF PRODUCTION DATA FIX, not a schema migration, so it lives in supabase/data-fixes/ (see README.md there) and not in
-- supabase/migrations/. It is NOT replayed by CI, which builds an empty database where this row does not exist.
--
-- WHY. `job_postings.company_name` is a copy of `organizations.name` taken when an employer posts. The organisation was renamed from
-- "Talentrah Portal" to "Talentrah" on 2026-10-02 15:31Z and this posting kept the old copy, so its page title, its JSON-LD
-- hiringOrganization and its OG image said "Talentrah Portal". Migration 0216 (applied 2026-10-03 19:01:57Z) makes every FUTURE rename
-- reach the organisation's internal postings; it does not touch a row that was already out of step, which is what this fixes.
--
-- Owner-approved (S2-13, 2026-10-03) after a rolled-back dry run against production: exactly 1 row matched, no other row changed, the
-- posting's 8 match_scores rows untouched (company_name is not a column the invalidation trigger watches).
-- Ingest never touches this row: it is source_type 'internal' with no external_source, and every ingest query is scoped by external_source.
--
-- NOTE ON THE STATEMENT SHAPE. The file's rule is `where id = '<uuid>'` plus the old value as the guard, so the new value is written as
-- the literal below. The statement actually run in production read the new value from the organisation row, guarded by it
-- (`update public.job_postings j set company_name = o.name from public.organizations o where o.id = j.organization_id and j.id = '...' and
-- j.source_type = 'internal' and j.company_name = 'Talentrah Portal' and o.name = 'Talentrah'`), which is the same row and the same result.
--
-- Needs: nothing (no migration). Left deliberately untouched: every other posting (the other 3 internal postings were already in step).
--
-- APPLY (production, read-write, after the owner's yes on the dry run):  run this file's APPLY block.
-- ROLLBACK: the second block at the bottom restores the old text, guarded by the new value.

-- ========================================== APPLY ==========================================
do $apply$
declare
  n integer;
begin
  update public.job_postings set company_name = 'Talentrah'
   where id = 'f7e65567-5674-405e-802b-cc0a9daf4762' and source_type = 'internal' and company_name = 'Talentrah Portal';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'Growth Marketer company_name: expected to update exactly 1 row, updated %', n; end if;
end
$apply$;

-- ========================================== ROLLBACK (not run) ==========================================
-- do $rollback$
-- declare
--   n integer;
-- begin
--   update public.job_postings set company_name = 'Talentrah Portal'
--    where id = 'f7e65567-5674-405e-802b-cc0a9daf4762' and source_type = 'internal' and company_name = 'Talentrah';
--   get diagnostics n = row_count;
--   if n <> 1 then raise exception 'rollback: expected to update exactly 1 row, updated %', n; end if;
-- end
-- $rollback$;

-- ========================================== RECORD (filled in when the APPLY block is run; execute_sql writes no ledger row) ==========================================
-- Applied at (UTC): 2026-10-03, between 19:02:00 and 19:02:21 (production, project nytwbbzfpytctjsoczzq; the read-back at 19:02:21Z already showed the new value)
-- Approved by:      the owner, in chat, 2026-10-03, on the rolled-back dry run (Block A in the report)
-- Row counts:       1 statement, exactly 1 row; the block completed without raising, which it does unless exactly 1 row changed.
-- Read-only checks after the apply:
--   - company_name of f7e65567-5674-405e-802b-cc0a9daf4762 is "Talentrah" (status open, unchanged);
--   - internal postings out of step with their organisation's name: 0 (was 1); postings named "Talentrah Portal": 0;
--   - match_scores rows for the posting: 8, as before;
--   - live page https://www.talentrah.com/jobs/f7e65567-5674-405e-802b-cc0a9daf4762 (no revalidation step: the page is `private, no-store`):
--     title "Growth Marketer at Talentrah — Remote | Talentrah", JSON-LD hiringOrganization.name "Talentrah", 0 mentions of "Talentrah Portal".
