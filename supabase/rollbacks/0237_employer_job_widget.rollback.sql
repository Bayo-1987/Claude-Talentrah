-- ROLLBACK for 0237 (the employer job-list widget, database part). Not a migration: it is the exact undo, kept beside the file it undoes so it is reviewed in the same diff and so nobody has to reconstruct it under
-- pressure. Run it as `postgres` in the SQL Editor, in ONE transaction (it is written to be). To keep what the schema ledger says honest, record it as a NEW migration (do not delete 0237's ledger row).
-- `supabase/rollbacks/` is outside supabase/migrations, so neither the migration-numbering check nor `supabase db push` ever sees it.
--
-- WHAT IT DESTROYS: the `employer_widgets` table and every row in it (each organisation's widget switch and max-jobs choice). Nothing else is touched: no posting, organisation, profile or grant outside the new objects.
-- Run it only after the code that calls org_job_widget is gone (or the public embed route will fail its read): the route has to be reverted first.
--
-- ORDER: the function first (it reads the table), then the table (its policies, trigger and column grants go with it), then the trigger function, then the index.

begin;

drop function if exists public.org_job_widget(uuid);
drop table if exists public.employer_widgets;
drop function if exists public.employer_widgets_touch_updated_at();
drop index if exists public.job_postings_org_open_internal_posted_idx;

commit;
