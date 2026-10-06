-- 0235: the operator alerts on Farah's daily spend ceiling: one small table and two functions that decide, in the database, who may try to send today's alert and when it counts as sent (S3).
--
-- WHAT IT IS FOR. Farah's daily spend ceiling emails the operator once when the day's estimated spend reaches 80% of the ceiling and once when the ceiling is reached. The day's alert must not be LOST
-- because one send failed (the mail provider down, the recipient not set): so "today's alert is done" is recorded only AFTER a send succeeded, and a failed send can be tried again by a later request the
-- same day, but a bounded number of times and with only one attempt in flight at a time. The count and the lease have to live in the database, not in a server's memory, so that they hold across server
-- instances and restarts.
--
-- WHAT IT ADDS (and nothing else; 0223's table llm_daily_usage and function add_llm_usage are NOT touched, not even their grants):
--   public.llm_daily_usage_alert_markers   one row per UTC day and alert ('eighty' or 'reached'): attempts so far, when the last attempt began, and when a send was recorded.
--   public.claim_llm_alert_attempt(alert, max_attempts default 3, lease_seconds default 10)
--        ONE statement. True for the caller that may try the send now: the alert is not yet recorded as sent today, fewer than max_attempts attempts were taken, and the previous attempt began at least
--        lease_seconds ago (so an attempt that is still running holds the others off). A true answer takes an attempt; it does NOT close the alert.
--   public.mark_llm_alert_sent(alert)
--        ONE statement. Records that today's alert went out; true for the call that recorded it, false if it was already recorded or no attempt was taken today.
-- The two alerts have separate rows on purpose: if one row covered both, a day that sent the 80% alert could never send the one that matters more.
--
-- HONEST LIMITS. At most max_attempts emails per alert per day, because an attempt can succeed at the mail provider and still be recorded as failed (the sender is given up on after 2 seconds, or the call that
-- records the success fails): a retry then sends a second copy. With the defaults that is at most 3 emails for one alert in one day, and only in those failure sequences; concurrent callers cannot both send,
-- because of the lease. An attempt that runs for longer than the lease can overlap the next one: the sender gives up after 2 seconds, well inside the 10-second default.
--
-- SERVER ONLY. The table has row level security on and no policy, every privilege revoked from everyone, and select, insert and update (not delete) granted to service_role only. Both functions are
-- SECURITY INVOKER with an empty search_path and executable by service_role only. The rows hold a day, an alert name, a count and two timestamps: no user, no personal data, nothing from the money tables.
--
-- ADDITIVE and applied BEFORE the code that uses it merges. Code that reaches production first gets an error from a function that does not exist, which it logs (content-free) and swallows: the alert simply
-- does not send; the reply and the 503 are never affected. The table holds at most two rows a day.
--
-- ROLLBACK is supabase/rollbacks/0235_llm_daily_usage_alert_markers.rollback.sql: it drops the two functions and then the table (take the alert code off first).

create table public.llm_daily_usage_alert_markers (
  day             date        not null,
  alert           text        not null,
  attempts        integer     not null default 0,
  last_attempt_at timestamptz,
  sent_at         timestamptz,
  constraint llm_daily_usage_alert_markers_pkey primary key (day, alert),
  constraint llm_daily_usage_alert_markers_alert_known check (alert in ('eighty', 'reached')),
  constraint llm_daily_usage_alert_markers_attempts_range check (attempts between 0 and 10)
);

comment on table public.llm_daily_usage_alert_markers is
  'Server-only. One row per UTC day (database clock) and operator alert on Farah''s spend ceiling (0235): attempts taken, when the last began, and when a send was recorded. Written only through claim_llm_alert_attempt and mark_llm_alert_sent, by service_role.';

alter table public.llm_daily_usage_alert_markers enable row level security;
revoke all on table public.llm_daily_usage_alert_markers from public, anon, authenticated, service_role;
grant select, insert, update on table public.llm_daily_usage_alert_markers to service_role;

create or replace function public.claim_llm_alert_attempt(p_alert text, p_max_attempts integer default 3, p_lease_seconds integer default 10)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  if p_alert is null or p_alert not in ('eighty', 'reached') then
    raise exception 'claim_llm_alert_attempt: unknown alert' using errcode = '22023';
  end if;
  if p_max_attempts is null or p_max_attempts < 1 or p_max_attempts > 10 then
    raise exception 'claim_llm_alert_attempt: max attempts out of range' using errcode = '22023';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 0 or p_lease_seconds > 600 then
    raise exception 'claim_llm_alert_attempt: lease out of range' using errcode = '22023';
  end if;

  -- One statement: the first attempt of the day inserts the row; later ones update it only while the three conditions hold. The row lock taken by the conflict update serialises concurrent callers, and
  -- a caller that waited re-checks the conditions against the row the winner just wrote, so two callers cannot both take the same attempt.
  insert into public.llm_daily_usage_alert_markers as m (day, alert, attempts, last_attempt_at)
  values ((pg_catalog.now() at time zone 'utc')::date, p_alert, 1, pg_catalog.now())
  on conflict (day, alert) do update set attempts = m.attempts + 1, last_attempt_at = pg_catalog.now()
  where m.sent_at is null
    and m.attempts < p_max_attempts
    and (m.last_attempt_at is null or m.last_attempt_at <= pg_catalog.now() - pg_catalog.make_interval(secs => p_lease_seconds))
  returning m.attempts into v_attempts;

  return v_attempts is not null;
end;
$$;

revoke all on function public.claim_llm_alert_attempt(text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_llm_alert_attempt(text, integer, integer) to service_role;

create or replace function public.mark_llm_alert_sent(p_alert text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_marked integer;
begin
  if p_alert is null or p_alert not in ('eighty', 'reached') then
    raise exception 'mark_llm_alert_sent: unknown alert' using errcode = '22023';
  end if;

  -- One statement: only today's row, only if an attempt was taken, only if not already recorded, so the second of two calls gets false.
  update public.llm_daily_usage_alert_markers set sent_at = pg_catalog.now()
  where day = (pg_catalog.now() at time zone 'utc')::date and alert = p_alert and attempts > 0 and sent_at is null
  returning 1 into v_marked;

  return v_marked is not null;
end;
$$;

revoke all on function public.mark_llm_alert_sent(text) from public, anon, authenticated, service_role;
grant execute on function public.mark_llm_alert_sent(text) to service_role;

-- Checks itself when it is applied: the apply fails, and nothing is kept, if a client role can execute either function or touch the table, if PUBLIC can execute either, if service_role lost either,
-- if either function is SECURITY DEFINER, or if the table has no row level security or has a policy.
do $check$
declare
  v_claim oid := 'public.claim_llm_alert_attempt(text, integer, integer)'::regprocedure;
  v_mark  oid := 'public.mark_llm_alert_sent(text)'::regprocedure;
  v_table oid := 'public.llm_daily_usage_alert_markers'::regclass;
  v_fn    oid;
  r       name;
begin
  foreach v_fn in array array[v_claim, v_mark] loop
    foreach r in array array['anon', 'authenticated'] loop
      if pg_catalog.has_function_privilege(r, v_fn, 'execute') then
        raise exception '0235 self-check: % can execute %', r, v_fn::regprocedure;
      end if;
    end loop;
    if exists (select 1 from pg_catalog.aclexplode(coalesce((select proacl from pg_catalog.pg_proc where oid = v_fn), pg_catalog.acldefault('f', (select proowner from pg_catalog.pg_proc where oid = v_fn)))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') then
      raise exception '0235 self-check: PUBLIC can execute %', v_fn::regprocedure;
    end if;
    if not pg_catalog.has_function_privilege('service_role', v_fn, 'execute') then
      raise exception '0235 self-check: service_role cannot execute %', v_fn::regprocedure;
    end if;
    if (select prosecdef from pg_catalog.pg_proc where oid = v_fn) then
      raise exception '0235 self-check: % must be SECURITY INVOKER', v_fn::regprocedure;
    end if;
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    if pg_catalog.has_table_privilege(r, v_table, 'select, insert, update, delete, truncate, references, trigger') then
      raise exception '0235 self-check: % holds a privilege on public.llm_daily_usage_alert_markers', r;
    end if;
  end loop;
  if not (select relrowsecurity from pg_catalog.pg_class where oid = v_table) then
    raise exception '0235 self-check: RLS is not enabled on public.llm_daily_usage_alert_markers';
  end if;
  if exists (select 1 from pg_catalog.pg_policy where polrelid = v_table) then
    raise exception '0235 self-check: public.llm_daily_usage_alert_markers has a policy (it must have none)';
  end if;
end
$check$;
