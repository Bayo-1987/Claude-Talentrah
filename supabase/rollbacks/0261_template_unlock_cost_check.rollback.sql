-- ROLLBACK for 0261 (resume_templates_premium_unlock_cost_check). Not a migration: it is the exact undo, kept beside the file it undoes so it is reviewed in the same diff.
-- Run it as `postgres` in the SQL Editor (one transaction). To keep what the schema ledger says honest, record it as a NEW migration (do not delete 0261's ledger row).
-- WHAT IT CHANGES: drops the one named CHECK constraint and nothing else; no row is read or changed, and the constraint's comment goes with it. ORDER: none, nothing depends on the constraint. After it runs, a premium template can again be saved at cost 0 (which nobody could then unlock), and the seeders' own check (assertValidTemplateDefinitions) is the only guard left.
begin;

alter table public.resume_templates drop constraint if exists resume_templates_premium_unlock_cost_check;

commit;
