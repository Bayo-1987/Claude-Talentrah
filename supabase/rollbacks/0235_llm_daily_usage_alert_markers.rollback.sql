-- ROLLBACK for 0235 (the operator-alert attempts on the daily spend ceiling). Not a migration: kept beside the file it undoes, outside supabase/migrations so nothing that reads migrations ever applies it.
-- Run it as `postgres` in the SQL Editor, as one multi-statement query (one implicit transaction: a failure anywhere rolls the whole script back, so there is no explicit begin or commit). To keep the schema ledger
-- honest, record it as a NEW migration row; do not delete 0235's own.
-- Order matters: take the alert code off first (code that still asks for an attempt after this runs gets an error from a function that no longer exists; it logs one content-free line and swallows it, so replies are
-- unaffected, but the operator alerts stop). 0223's objects are not touched by 0235 and are not touched here. The two rows a day this table holds are attempt counts and times only, so dropping them loses nothing else.

set local lock_timeout = '2s';
set local statement_timeout = '20s';

drop function public.claim_llm_alert_attempt(text, integer, integer);
drop function public.mark_llm_alert_sent(text);
drop table public.llm_daily_usage_alert_markers;

do $check$
begin
  if to_regprocedure('public.claim_llm_alert_attempt(text, integer, integer)') is not null then
    raise exception '0235 rollback self-check: claim_llm_alert_attempt is still there';
  end if;
  if to_regprocedure('public.mark_llm_alert_sent(text)') is not null then
    raise exception '0235 rollback self-check: mark_llm_alert_sent is still there';
  end if;
  if to_regclass('public.llm_daily_usage_alert_markers') is not null then
    raise exception '0235 rollback self-check: llm_daily_usage_alert_markers is still there';
  end if;
end
$check$;
