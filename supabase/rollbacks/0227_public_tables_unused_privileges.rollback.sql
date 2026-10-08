-- 0227 rollback (remainder): give anon and authenticated MAINTAIN back on every table in public and in the postgres role's default privileges (PostgreSQL 17 and later only), give them EXECUTE on the two referral functions
-- back, and drop the snapshot function. This restores the default, not an exact per-table prior state; the exact prior state is whatever the pre-apply audit recorded (reports/S3-21/raw/0229/). Run only on the owner's separate approval.
do $rb$
declare
  t record;
begin
  if current_setting('server_version_num')::int >= 170000 then
    for t in
      select pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname) as tbl
        from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p')
       order by c.relname
    loop
      execute pg_catalog.format('grant maintain on table %s to anon, authenticated', t.tbl);
    end loop;
    alter default privileges in schema public grant maintain on tables to anon, authenticated;
  end if;
end
$rb$;
grant execute on function public.count_rewarded_referrals_last_30d(uuid, uuid) to anon, authenticated;
grant execute on function public.check_and_activate_referral(uuid) to anon, authenticated;
drop function if exists public.table_privilege_snapshot();
