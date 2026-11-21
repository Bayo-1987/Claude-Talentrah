-- Rollback of 0284: removes the one flag row it seeded. Nothing reads the flag yet, so nothing else changes.
delete from public.feature_flags where key = 'admin_messaging_self_approve';
