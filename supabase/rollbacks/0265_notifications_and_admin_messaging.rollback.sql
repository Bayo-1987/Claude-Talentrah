-- Rollback of 0265 part 1. Removes the seven tables (their triggers, policies, indexes and grants go with them) and the two trigger functions.
-- Every statement is "if exists", so the file runs cleanly on a database where 0265 was never applied and can be run twice. Later parts of 0265 add their own lines ABOVE these.
-- The tables go child first. There are no rows to preserve: nothing outside these tables refers to them.
drop table if exists public.notification_setting_changes cascade;
drop table if exists public.notification_settings cascade;
drop table if exists public.admin_message_events cascade;
drop table if exists public.admin_message_recipients cascade;
drop table if exists public.admin_messages cascade;
drop table if exists public.notification_deliveries cascade;
drop table if exists public.push_subscriptions cascade;
drop function if exists public.notification_guard_append_only();
drop function if exists public.notification_guard_message_edit();
