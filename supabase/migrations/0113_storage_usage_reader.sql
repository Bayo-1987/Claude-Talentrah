-- 0113: let the ops page see how much Storage is being used.
--
-- ── WHY THIS NEEDS A MIGRATION AT ALL, WHICH WAS NOT THE ASSUMPTION ───────
--
-- src/lib/admin/ops/queries.ts opens by saying "nothing needed a new grant:
-- the service role already reads all of it. That was checked rather than
-- assumed, and it is the reason M5 ships without a migration." That is still
-- true of every table it reads. `storage.objects` is the first thing it wants
-- that breaks the pattern, and the reason is not privileges:
--
--     has_table_privilege('service_role','storage.objects','SELECT')  ->  true
--     supabase.schema('storage').from('objects').select('id')         ->  PGRST106
--                                                    Invalid schema: storage
--
-- Both measured, the second by an actual request with the real service-role
-- key. The service role CAN read the table in SQL; PostgREST simply does not
-- expose the `storage` schema, so the application cannot reach it that way.
-- The grant question and the reachability question have different answers, and
-- checking only the first would have produced a confident wrong conclusion.
--
-- The alternative — adding `storage` to PostgREST's exposed schemas — would
-- open every storage table to the API surface to answer one aggregate. This
-- function exposes exactly the aggregate and nothing else: no object names, no
-- paths, no owners, no per-file rows.
--
-- ── WHY SECURITY DEFINER, AND WHY ONLY service_role MAY CALL IT ───────────
--
-- DEFINER because the caller is `service_role` over PostgREST, which reaches
-- `public` but not `storage`; the function runs as its owner and reads across.
-- Then EXECUTE is revoked from `public`, `anon` and `authenticated` and granted
-- to `service_role` alone, so the elevated read is reachable only by the server
-- code that already runs behind `requirePermission("operations")`.
--
-- Storage totals are not secret, but they are operational, and a DEFINER
-- function that anyone could call is a habit worth not forming — 0027 is this
-- repo's own example of a grant list being got wrong in the other direction.

create or replace function public.storage_bucket_usage()
returns table (
  bucket_id text,
  is_public boolean,
  object_count bigint,
  bytes bigint
)
language sql
stable
security definer
set search_path = public, storage
as $$
  select
    b.id,
    b.public,
    count(o.id),
    -- `metadata->>'size'` is where Storage records an object's byte length.
    -- LEFT JOIN plus coalesce so a bucket that exists with nothing in it
    -- reports 0 rather than vanishing from the list — an empty bucket is a
    -- fact the ops page should show, not an absence it should infer.
    coalesce(sum((o.metadata->>'size')::bigint), 0)
  from storage.buckets b
  left join storage.objects o on o.bucket_id = b.id
  group by b.id, b.public
  order by b.id;
$$;

revoke all on function public.storage_bucket_usage() from public, anon, authenticated;
grant execute on function public.storage_bucket_usage() to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.storage_bucket_usage()', 'execute')
     or has_function_privilege('authenticated', 'public.storage_bucket_usage()', 'execute') then
    raise exception
      'storage_bucket_usage is callable by a client role; it is a SECURITY DEFINER read across the storage schema and must stay service-role only.';
  end if;
  if not has_function_privilege('service_role', 'public.storage_bucket_usage()', 'execute') then
    raise exception
      'storage_bucket_usage is not callable by service_role; the ops page would show no storage figures at all.';
  end if;
end $$;
