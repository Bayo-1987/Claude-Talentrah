-- 0264: `user_messaging` — sending messages to users is its own grant.
--
-- WHAT THIS IS FOR. An admin can prepare, approve and send a notice to many people at once (the main notifications migration, 0265, adds the tables and functions). The power to reach
-- every user is not a plain content area: like 0262's `data_export`, 0116's `employer_verification` and 0103's `people_list`, it STARTS GRANTED TO NOBODY and is a deliberate
-- per-operator decision made in /admin/operators.
--
-- THIS FILE IS ONE STATEMENT AND NOTHING ELSE: no `do` block, no check, no second statement. The house pattern for enum-add migrations is one statement, the hosted wrappers gate on this
-- file's text hash, and Postgres forbids using a new enum value in the transaction that adds it (55P04 "unsafe use of new value"; see 0077/0078). A cast, a comparison or a function call
-- naming the new value as the enum type, anywhere in a file applied in the same transaction, would abort the whole apply. So 0265 is a SEPARATE file and reads the permission only at call
-- time, through `admin_has_permission`, and never names the value as the enum type in its own text.
--
-- THE CHECKS ARE NOT IN THIS FILE. They read labels as text and live in tests/supabase/migration-0264-enum.test.ts (run after the migrations are applied).
--
-- `admin_permission_catalog()` (0079) is `unnest(enum_range(...))`, so the value appears in the role editor with no change there.
--
-- ROLLBACK (supabase/rollbacks/0264_user_messaging_permission.rollback.sql): a Postgres enum value cannot be dropped. The rollback only removes any role grants of it, compared as text, and
-- the value is left in place; an unused label is harmless.

alter type public.admin_permission add value if not exists 'user_messaging';
