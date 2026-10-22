-- Rollback of 0265 (parts 1 and 2). Removes the ledger functions, the seven tables (their triggers, policies, indexes and grants go with them) and the two trigger functions.
-- Every statement is "if exists", so the file runs cleanly on a database where 0265 was never applied and can be run twice. Later parts of 0265 add their own lines ABOVE these.
-- The functions go first, then the tables child first. There are no rows to preserve: nothing outside these tables refers to them.
drop function if exists public.prune_notification_deliveries(integer);
drop function if exists public.unread_notification_count(uuid);
drop function if exists public.resolve_stale_claim(uuid, uuid, text);
drop function if exists public.stale_notification_claims(text, interval);
drop function if exists public.mark_notification_sent(uuid);
drop function if exists public.release_notification(uuid, text);
drop function if exists public.claim_notification(uuid, text, uuid, text, uuid, interval);
drop function if exists public.notification_in_quiet_hours(timestamptz, text);
drop table if exists public.notification_setting_changes cascade;
drop table if exists public.notification_settings cascade;
drop table if exists public.admin_message_events cascade;
drop table if exists public.admin_message_recipients cascade;
drop table if exists public.admin_messages cascade;
drop table if exists public.notification_deliveries cascade;
drop table if exists public.push_subscriptions cascade;
drop function if exists public.notification_guard_append_only();
drop function if exists public.notification_guard_message_edit();
