-- 0276: `jobs_import` — uploading a CSV of jobs to the public feed from the admin dashboard is its own grant.
--
-- WHAT THIS IS FOR. An admin uploads a sheet of jobs (the same 17 columns as the jobs-sheet import script), sees a preview, and confirms; the rows go live on the public feed at once.
-- That is a publishing power over a public surface, not a plain content area, so it follows 0103 (`people_list`), 0116 (`employer_verification`), 0262 (`data_export`) and 0264
-- (`user_messaging`): it STARTS GRANTED TO NOBODY and is a deliberate per-operator decision made in /admin/operators by someone who holds `operators`.
--
-- THIS FILE IS ONE STATEMENT AND NOTHING ELSE: no `do` block, no check, no second statement. The house pattern for enum-add migrations is one statement, the hosted wrappers gate on this
-- file's text hash, and Postgres forbids using a new enum value in the transaction that adds it (55P04 "unsafe use of new value"; see 0077/0078/0262). The checks are catalog-text reads and
-- live in tests/supabase/jobs-import-permission-enum.test.ts (local database) and in the hosted post-check built from the same SQL: the label is present in public.admin_permission (read
-- from pg_catalog.pg_enum as text) and no public.admin_role_permissions row holds it (compared as text).
--
-- `admin_permission_catalog()` (0079) is `unnest(enum_range(...))`, so the value appears in the role editor with no change there.
--
-- Additive: apply BEFORE the code that names the value merges (supabase/migrations/README.md, "When to apply, relative to merging").
--
-- ROLLBACK (supabase/rollbacks/0276_jobs_import_permission.rollback.sql): a Postgres enum value cannot be dropped. The rollback only removes any role grants of it, compared as text, and
-- the value is left in place; an unused label is harmless.

alter type public.admin_permission add value if not exists 'jobs_import';
