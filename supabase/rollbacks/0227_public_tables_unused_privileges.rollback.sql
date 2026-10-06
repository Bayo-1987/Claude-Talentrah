-- 0227 rollback: give anon and authenticated TRUNCATE, REFERENCES, TRIGGER and MAINTAIN back on every public table and in the default privileges of the postgres role for schema public (the Supabase default), give them EXECUTE on the two referral
-- functions back, and drop the snapshot function. This restores the default, not an exact per-table prior state; the exact prior state is whatever the pre-apply C3b read recorded (52 tables for anon, 55 for authenticated, on each project). Run only
-- on the owner's separate approval.
do $rb$
declare
  r record;
  privs text := case when current_setting('server_version_num')::int >= 170000 then 'truncate, references, trigger, maintain' else 'truncate, references, trigger' end;
begin
  for r in select c.oid::regclass::text as t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') loop
    execute format('grant %s on table %s to anon, authenticated', privs, r.t);
  end loop;
  execute format('alter default privileges for role postgres in schema public grant %s on tables to anon, authenticated', privs);
end
$rb$;
grant execute on function public.count_rewarded_referrals_last_30d(uuid, uuid) to anon, authenticated;
grant execute on function public.check_and_activate_referral(uuid) to anon, authenticated;
drop function if exists public.table_privilege_snapshot();
