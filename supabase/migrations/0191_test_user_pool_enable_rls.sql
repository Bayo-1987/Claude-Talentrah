-- send-455 follow-up: 0188_test_user_pool.sql created public.test_user_pool
-- and revoked all privileges from authenticated/anon, but never enabled row
-- level security on it — the one table in this repo that skips the pattern
-- every comparable test-harness-only table uses (e.g. one_tap_moments, 0186:
-- RLS enabled, zero policies, deny-all except service role). Found by
-- Supabase's own advisor (rls_disabled, critical) after applying every
-- migration fresh to a new project during send-455.
--
-- The revoked grants already mean authenticated/anon have no effective
-- access regardless of RLS state — Postgres checks table privileges before
-- RLS ever runs, so this migration changes no real caller's behavior. It
-- closes the gap between what the grants already enforce and what the
-- security scanner (and every other table's own convention) expects to see.
alter table public.test_user_pool enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'test_user_pool' and c.relrowsecurity
  ) then
    raise exception 'test_user_pool did not end up with row level security enabled';
  end if;
end $$;
