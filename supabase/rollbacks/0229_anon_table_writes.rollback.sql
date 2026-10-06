-- 0229 rollback: give anon INSERT, UPDATE and DELETE back on every public table and in the default privileges of the postgres role for schema public (the Supabase default). This restores the default, not an exact per-table prior state; the exact
-- prior state is whatever the pre-apply Q2 read recorded. Run only on the owner's separate approval.
do $rb$
declare
  r record;
begin
  for r in select c.oid::regclass::text as t from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') loop
    execute format('grant insert, update, delete on table %s to anon', r.t);
  end loop;
  alter default privileges for role postgres in schema public grant insert, update, delete on tables to anon;
end
$rb$;
