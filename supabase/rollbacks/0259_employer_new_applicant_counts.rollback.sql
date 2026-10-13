-- ROLLBACK for 0259 (employer_new_applicant_counts). Not a migration: it is the exact undo, kept beside the file it undoes so it is reviewed in the same diff.
-- Run it as `postgres` in the SQL Editor (one transaction). To keep what the schema ledger says honest, record it as a NEW migration (do not delete 0259's ledger row).
-- WHAT IT CHANGES: the function only. ORDER: deploy the code that calls it away first (the Jobs Posted page would otherwise fail to load its "N new" counts; the page treats an error as "no badge", so the worst case is no badge).
begin;

drop function if exists public.employer_new_applicant_counts(uuid);

commit;
