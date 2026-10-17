-- Rollback for 0262: no role keeps `data_export`. Compared as TEXT.
-- The enum label itself STAYS: Postgres cannot drop an enum value, and an unused label is harmless.
delete from public.admin_role_permissions where permission::text = 'data_export';
