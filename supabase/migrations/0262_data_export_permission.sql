-- 0262: `data_export` — producing a person's data export is its own grant.
--
-- WHAT THIS IS FOR. An admin, on a support request, produces a copy of one person's data (docs/admin-data-export.md). The power to read everything the
-- account holds, for one person, is not a plain content area like `blog`: it is the most sensitive read this dashboard will have. Exactly 0103's
-- (`people_list`) and 0116's (`employer_verification`) precedent, and for the same reason, it STARTS GRANTED TO NOBODY and is a deliberate per-operator
-- decision made in /admin/operators. Handing it to whoever already holds another permission would make the split cosmetic.
--
-- ONE STATEMENT PLUS A CHECK THAT NEVER NAMES THE NEW VALUE AS AN ENUM. Postgres forbids using a new enum value in the same transaction that adds it
-- (55P04 "unsafe use of new value"); see 0077/0078 for the failure this avoids. A cast such as 'data_export'::public.admin_permission, a comparison against
-- it, or any function call taking it would abort this very file. So the after-state check below reads the labels out of pg_catalog.pg_enum AS TEXT and
-- compares text with text. Proving that the permission WORKS (a role can hold it, the guard honours it) is a separate, later, read-only step, in a
-- different transaction, and is not part of this file.
-- tests/supabase/data-export-permission-enum.test.ts shows the unsafe form failing with 55P04 on the local stack and this form passing.
--
-- `admin_permission_catalog()` (0079) is `unnest(enum_range(...))`, so the value appears in the role editor with no change there.
--
-- ROLLBACK (supabase/rollbacks/0262_data_export_permission.rollback.sql) deletes any role-permission rows that hold it, comparing as TEXT. The enum value
-- itself STAYS: Postgres cannot drop an enum value, and an unused label is harmless. Nothing reads it once no role holds it.

alter type public.admin_permission add value if not exists 'data_export';

do $check$
declare
  v_labels text[];
begin
  select pg_catalog.array_agg(e.enumlabel::text order by e.enumsortorder)
    into v_labels
    from pg_catalog.pg_enum e
   where e.enumtypid = 'public.admin_permission'::regtype;
  if not ('data_export' = any (v_labels)) then
    raise exception '0262 self-check: admin_permission has no data_export label (labels: %)', v_labels;
  end if;
  -- Granted to nobody: compared as TEXT, never by casting the new label.
  if exists (select 1 from public.admin_role_permissions p where p.permission::text = 'data_export') then
    raise exception '0262 self-check: a role already holds data_export (it must start granted to nobody)';
  end if;
end
$check$;
