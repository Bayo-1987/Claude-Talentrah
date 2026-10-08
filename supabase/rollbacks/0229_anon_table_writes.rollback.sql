-- 0229 rollback: give anon INSERT, UPDATE and DELETE back on every table in public and in the default privileges of the postgres role for schema public (the Supabase default). This restores the default, not an exact
-- per-table prior state; the exact prior state is whatever the pre-apply audit recorded (reports/S3-21/raw/0229/). Run only on the owner's separate approval.
do $rb$
declare
  t record;
begin
  for t in
    select pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname) as tbl
      from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname
  loop
    execute pg_catalog.format('grant insert, update, delete on table %s to anon', t.tbl);
  end loop;
  alter default privileges in schema public grant insert, update, delete on tables to anon;
end
$rb$;
