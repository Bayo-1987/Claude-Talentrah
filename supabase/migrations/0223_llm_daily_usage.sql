-- 0223: the daily LLM usage counter (S3-82/83/84).
--
-- WHAT IT IS FOR. Farah chat's daily spend ceiling needs one number that every server instance reads and adds to atomically: today's estimated spend
-- in whole nano-dollars (1 nano-dollar = 10^-9 USD). The ceiling itself, the price table and the estimate arithmetic live in the app
-- (src/lib/farah/spend-ceiling.ts); this migration is only the counter. Nothing reads or writes it except the server, as service_role.
--
-- WHAT IT ADDS. One table and one function. Nothing existing is altered, so it is additive: it applies BEFORE the code that uses it merges.
--
-- THE DAY comes from the DATABASE clock, in UTC: (pg_catalog.now() at time zone 'utc')::date. The function takes no day argument, so a caller cannot
-- write to another day and the app and the counter cannot disagree about which day it is.
--
-- TWO BUCKETS, and the second one is not money. `farah_chat` holds the day's estimated spend in nano-dollars. `farah_chat_half_warned` holds a CALL
-- COUNT in the same `nano_usd` column: the first caller of the day to add 1 gets 1 back and writes the one "50% reached" log line; everyone after gets
-- 2, 3, ... That is acceptable because the column is only ever read per bucket, the two buckets are never summed or shown as dollars, there is one row
-- per bucket per day, and a second column (or a second table) would add schema to carry a flag. The name is wrong for that bucket; the comment on the
-- column says so, so nobody sums the bucket as money.
--
-- WHO CAN TOUCH IT. service_role only. Every other role (PUBLIC, anon, authenticated) is explicitly revoked, RLS is on with NO policies, and
-- service_role's own privileges are written out (not left to Supabase's default privileges): SELECT, INSERT, UPDATE on the table and EXECUTE on
-- the function. No DELETE, no TRUNCATE: nothing in the app needs either, and the table holds two small rows a day.
--
-- SECURITY INVOKER, not DEFINER. If an execute grant ever leaked to a client role the call would still fail for want of table privileges.
-- `search_path` is pinned to empty, so every table and function the body names is schema-qualified (public.llm_daily_usage, pg_catalog.now()).
-- Operators and built-in type names (+, <, >, bigint, date, text) resolve through the implicit pg_catalog lookup that applies even to an empty
-- search_path; they cannot be schema-qualified without OPERATOR() syntax.
--
-- INPUT IS VALIDATED. A null or unknown bucket, a null or negative amount, and an amount above 100,000,000,000 nano-dollars ($100; a real worst-case
-- reply is about 1.7 million) raise SQLSTATE 22023. A non-integer or non-numeric amount fails earlier, at the bigint cast of the argument. The total is a
-- bigint (about 9.2 x 10^18 nano-dollars, $9.2 billion): an add that would overflow raises 22003 and changes nothing; it never wraps.
--
-- ROLLBACK is never needed for safety: the table is additive and harmless to leave. To remove it: drop function public.add_llm_usage(text, bigint);
-- drop table public.llm_daily_usage;

create table if not exists public.llm_daily_usage (
  day      date   not null,
  bucket   text   not null,
  nano_usd bigint not null default 0,
  primary key (day, bucket),
  constraint llm_daily_usage_nano_usd_nonneg check (nano_usd >= 0),
  constraint llm_daily_usage_bucket_known check (bucket in ('farah_chat', 'farah_chat_half_warned'))
);

comment on table public.llm_daily_usage is
  'Server-only daily counters for LLM spend (0223). One row per UTC day (database clock) per bucket. Written only through public.add_llm_usage, by service_role.';
comment on column public.llm_daily_usage.nano_usd is
  'Bucket farah_chat: estimated spend in nano-dollars (10^-9 USD). Bucket farah_chat_half_warned: a CALL COUNT, not money (the first caller of the day gets 1). Never sum across buckets.';

alter table public.llm_daily_usage enable row level security;
revoke all on table public.llm_daily_usage from public, anon, authenticated, service_role;
grant select, insert, update on table public.llm_daily_usage to service_role;

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

-- Checks itself when it is applied: the apply fails, and nothing is kept, if the closed-to-clients design did not come out as written.
do $check$
declare
  v_table oid := 'public.llm_daily_usage'::regclass;
  v_fn    oid := 'public.add_llm_usage(text, bigint)'::regprocedure;
  r       name;
  p       text;
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid = v_table) then
    raise exception '0223 self-check: RLS is not enabled on public.llm_daily_usage';
  end if;
  if exists (select 1 from pg_catalog.pg_policy where polrelid = v_table) then
    raise exception '0223 self-check: public.llm_daily_usage has a policy (it must have none)';
  end if;

  foreach r in array array['anon', 'authenticated'] loop
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if pg_catalog.has_table_privilege(r, v_table, p) then
        raise exception '0223 self-check: % holds % on public.llm_daily_usage', r, p;
      end if;
    end loop;
    if pg_catalog.has_function_privilege(r, v_fn, 'execute') then
      raise exception '0223 self-check: % can execute public.add_llm_usage', r;
    end if;
  end loop;

  if exists (select 1 from pg_catalog.aclexplode(coalesce((select relacl from pg_catalog.pg_class where oid = v_table), pg_catalog.acldefault('r', (select relowner from pg_catalog.pg_class where oid = v_table)))) a where a.grantee = 0) then
    raise exception '0223 self-check: PUBLIC holds a privilege on public.llm_daily_usage';
  end if;
  if exists (select 1 from pg_catalog.aclexplode(coalesce((select proacl from pg_catalog.pg_proc where oid = v_fn), pg_catalog.acldefault('f', (select proowner from pg_catalog.pg_proc where oid = v_fn)))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception '0223 self-check: PUBLIC can execute public.add_llm_usage';
  end if;

  if not (pg_catalog.has_table_privilege('service_role', v_table, 'select')
      and pg_catalog.has_table_privilege('service_role', v_table, 'insert')
      and pg_catalog.has_table_privilege('service_role', v_table, 'update')) then
    raise exception '0223 self-check: service_role lacks select, insert or update on public.llm_daily_usage';
  end if;
  if not pg_catalog.has_function_privilege('service_role', v_fn, 'execute') then
    raise exception '0223 self-check: service_role cannot execute public.add_llm_usage';
  end if;
end
$check$;
