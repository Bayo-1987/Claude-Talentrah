-- Rollback for 0262. A Postgres enum value CANNOT be dropped, so this does not remove the `data_export` label from public.admin_permission: it is left in place, unused and harmless.
-- What it does is remove any role grants of it, comparing as TEXT (never by casting the value to the enum type).
delete from public.admin_role_permissions where permission::text = 'data_export';
