-- 0235: two more markers on the daily LLM usage counter, for the operator alerts on Farah's spend ceiling (S3).
--
-- WHAT IT IS FOR. Farah's daily spend ceiling now emails the operator once when the day's estimated spend reaches 80% of the ceiling and once when the ceiling is
-- reached. "Once a day" is decided here, by the counter, the same way the 50% log line already is: each alert has a marker bucket, and the caller whose add of 1 returns 1
-- is the first of the day. That holds across server instances and restarts, which an in-memory flag would not.
--
-- WHAT IT CHANGES. 0223 allowed two buckets, in two places: the CHECK on public.llm_daily_usage and the validation inside public.add_llm_usage. Both lists grow by the same two names:
--   farah_chat_80_warned       a CALL COUNT (like farah_chat_half_warned), not money: the first caller of the day to see 80% gets 1 back.
--   farah_chat_reached_warned  a CALL COUNT, not money: the first caller of the day to be blocked at the ceiling gets 1 back.
-- They are separate on purpose: if one marker covered both, a day that sent the 80% alert could never send the one that matters more.
-- Nothing else changes: not the columns, the grants, RLS, the day (still the database clock, UTC), the validation of the amount, or the single-statement add. 0223's own file is not
-- edited (an applied migration never is); this redefines the two places that hold the list.
--
-- ADDITIVE. The CHECK is replaced in one statement (drop and add together), and every existing row (the two old buckets) satisfies the new list, so nothing is rejected or rewritten.
-- The function is replaced with create or replace: same signature, same owner, and its privileges are stated again below. The table holds two to four small rows a day, so the brief lock is not a concern.
-- It applies BEFORE the code that uses it merges: code that asks for a bucket the old list rejects would make the alert's marker fail (swallowed: the alert is optional), never the reply.
--
-- ROLLBACK is supabase/rollbacks/0235_llm_daily_usage_alert_markers.rollback.sql: it removes the rows of the two new buckets, then puts the two-bucket list back in both places.

alter table public.llm_daily_usage
  drop constraint llm_daily_usage_bucket_known,
  add constraint llm_daily_usage_bucket_known check (bucket in ('farah_chat', 'farah_chat_half_warned', 'farah_chat_80_warned', 'farah_chat_reached_warned'));

comment on column public.llm_daily_usage.nano_usd is
  'Bucket farah_chat: estimated spend in nano-dollars (10^-9 USD). Buckets farah_chat_half_warned, farah_chat_80_warned and farah_chat_reached_warned: CALL COUNTS, not money (the first caller of the day gets 1). Never sum across buckets.';

create or replace function public.add_llm_usage(p_bucket text, p_nano bigint)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_total bigint;
begin
  if p_bucket is null or p_bucket not in ('farah_chat', 'farah_chat_half_warned', 'farah_chat_80_warned', 'farah_chat_reached_warned') then
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

-- Checks itself when it is applied: the apply fails, and nothing is kept, if the function is still reachable by a client role, or if service_role lost it.
do $check$
declare
  v_fn oid := 'public.add_llm_usage(text, bigint)'::regprocedure;
  r    name;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if pg_catalog.has_function_privilege(r, v_fn, 'execute') then
      raise exception '0235 self-check: % can execute public.add_llm_usage', r;
    end if;
  end loop;
  if exists (select 1 from pg_catalog.aclexplode(coalesce((select proacl from pg_catalog.pg_proc where oid = v_fn), pg_catalog.acldefault('f', (select proowner from pg_catalog.pg_proc where oid = v_fn)))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception '0235 self-check: PUBLIC can execute public.add_llm_usage';
  end if;
  if not pg_catalog.has_function_privilege('service_role', v_fn, 'execute') then
    raise exception '0235 self-check: service_role cannot execute public.add_llm_usage';
  end if;
  if (select prosecdef from pg_catalog.pg_proc where oid = v_fn) then
    raise exception '0235 self-check: public.add_llm_usage must be SECURITY INVOKER';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.llm_daily_usage'::regclass and conname = 'llm_daily_usage_bucket_known' and pg_catalog.pg_get_constraintdef(oid) like '%farah_chat_80_warned%' and pg_catalog.pg_get_constraintdef(oid) like '%farah_chat_reached_warned%') then
    raise exception '0235 self-check: the bucket CHECK does not list the two new markers';
  end if;
end
$check$;
