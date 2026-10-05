-- ROLLBACK for 0235 (the two operator-alert markers on the daily LLM usage counter). Not a migration: kept beside the file it undoes, outside supabase/migrations so nothing that reads migrations ever applies it.
-- It is only needed if the alert code is reverted AND someone wants the two-bucket list back; leaving 0235 in place is harmless (a wider list that nothing writes to).
-- Run it as `postgres` in the SQL Editor, as one multi-statement query (one implicit transaction: a failure anywhere rolls the whole script back, so there is no explicit begin or commit). To keep the schema ledger honest, record it as a NEW migration (do not delete 0235's ledger row).
-- It deletes the rows of the two marker buckets first (they are call counts, not money, and exist only to say "someone already sent today's alert"); the CHECK could not be put back while they exist.
-- Order matters: take the alert code off first (nothing may be writing the new buckets while this runs, or the CHECK is refused and the whole script stops, which is safe).

set local lock_timeout = '2s';
set local statement_timeout = '20s';

delete from public.llm_daily_usage where bucket in ('farah_chat_80_warned', 'farah_chat_reached_warned');

alter table public.llm_daily_usage
  drop constraint llm_daily_usage_bucket_known,
  add constraint llm_daily_usage_bucket_known check (bucket in ('farah_chat', 'farah_chat_half_warned'));

comment on column public.llm_daily_usage.nano_usd is
  'Bucket farah_chat: estimated spend in nano-dollars (10^-9 USD). Bucket farah_chat_half_warned: a CALL COUNT, not money (the first caller of the day gets 1). Never sum across buckets.';

create or replace function public.add_llm_usage(p_bucket text, p_nano bigint)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total bigint;
begin
  if p_bucket is null or p_bucket not in ('farah_chat', 'farah_chat_half_warned') then
    raise exception 'add_llm_usage: unknown bucket' using errcode = '22023';
  end if;
  if p_nano is null or p_nano < 0 or p_nano > 100000000000 then
    raise exception 'add_llm_usage: amount out of range' using errcode = '22023';
  end if;

  -- One statement: the row lock taken by the conflict update serialises concurrent callers, so every caller sees its own running total.
  insert into public.llm_daily_usage as u (day, bucket, nano_usd)
  values ((pg_catalog.now() at time zone 'utc')::date, p_bucket, p_nano)
  on conflict (day, bucket) do update set nano_usd = u.nano_usd + excluded.nano_usd
  returning u.nano_usd into v_total;

  return v_total;
end;
$$;

revoke all on function public.add_llm_usage(text, bigint) from public, anon, authenticated, service_role;
grant execute on function public.add_llm_usage(text, bigint) to service_role;

do $check$
declare
  v_fn oid := 'public.add_llm_usage(text, bigint)'::regprocedure;
begin
  if pg_catalog.has_function_privilege('anon', v_fn, 'execute') or pg_catalog.has_function_privilege('authenticated', v_fn, 'execute') or not pg_catalog.has_function_privilege('service_role', v_fn, 'execute') then
    raise exception '0235 rollback self-check: the function grants are not service_role only';
  end if;
  if pg_catalog.pg_get_constraintdef((select oid from pg_catalog.pg_constraint where conrelid = 'public.llm_daily_usage'::regclass and conname = 'llm_daily_usage_bucket_known')) like '%farah_chat_80_warned%' then
    raise exception '0235 rollback self-check: the CHECK still lists the new markers';
  end if;
end
$check$;

