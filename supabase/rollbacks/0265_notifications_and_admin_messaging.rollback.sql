-- Rollback of 0265 (parts 1 to 4). Removes the twelve admin-message, setting and eligibility functions, the device, unsubscribe and revoke functions and trigger, the seven preference columns and the five flag rows, the ledger functions, the seven tables (their triggers, policies, indexes and grants go with them) and the two trigger functions.
-- Every statement is "if exists", so the file runs cleanly on a database where 0265 was never applied and can be run twice. Later parts of 0265 add their own lines ABOVE these.
-- The functions go first, then the tables child first. There are no rows to preserve: nothing outside these tables refers to them.
drop function if exists public.admin_email_eligible_recipients(uuid[], text);
drop function if exists public.resume_admin_message_send(uuid, uuid);
drop function if exists public.pause_admin_message_send(uuid, text);
drop function if exists public.set_notification_setting(text, integer, uuid);
drop function if exists public.record_admin_message_test(uuid, uuid);
drop function if exists public.admin_message_audit(uuid, uuid);
drop function if exists public.start_admin_message_send(uuid, uuid);
drop function if exists public.cancel_admin_message(uuid, uuid);
drop function if exists public.approve_admin_message(uuid, uuid, text);
drop function if exists public.submit_admin_message(uuid, uuid);
drop function if exists public.prepare_admin_message(uuid, uuid, integer);
drop function if exists public.resolve_admin_segment(text, jsonb, uuid);
drop trigger if exists notification_revoke_devices_on_deletion_request on public.profiles;
drop function if exists public.notification_revoke_devices_on_deletion_request();
drop function if exists public.email_unsubscribe_stream(text, text, boolean);
drop function if exists public.register_push_subscription(text, text, text, text, text);
alter table public.email_preferences
  drop column if exists push_enabled, drop column if exists push_new_applicant, drop column if exists push_application_viewed, drop column if exists push_match_alert,
  drop column if exists push_promotions, drop column if exists email_promotions, drop column if exists email_announcements;
delete from public.feature_flags where key in ('notifications_master', 'push_sender', 'admin_messaging', 'admin_promotions', 'admin_email');
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
