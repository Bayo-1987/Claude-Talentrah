-- ROLLBACK for 0236 (the atomic free-message claim). Not a migration: kept beside the file it undoes, outside supabase/migrations so nothing that reads migrations ever applies it.
-- Run it as `postgres` in the SQL Editor, as one multi-statement query (one implicit transaction: a failure anywhere rolls the whole script back, so there is no explicit begin or commit). To keep the schema
-- ledger honest, record it as a NEW migration row; do not delete 0236's own.
-- Order matters: take the claim code off first. Code that still asks for a claim after this runs finds the function missing, logs one content-free line and falls back to the old check-then-commit path, so
-- free messages keep working but without the protection. Pending claims at the moment of the rollback are dropped with the table: each is a free slot held for at most 120 seconds by a reply in flight, and
-- a reply that then tries to commit its claim gets an error from a function that no longer exists (logged, the reply itself is delivered); the credit_gate_events rows already written are untouched.

set local lock_timeout = '2s';
set local statement_timeout = '20s';

drop function public.claim_farah_free_message(uuid, integer, integer, integer);
drop function public.commit_farah_free_claim(uuid, uuid, integer);
drop function public.release_farah_free_claim(uuid, uuid);
drop table public.farah_free_claims;

do $check$
begin
  if to_regprocedure('public.claim_farah_free_message(uuid, integer, integer, integer)') is not null then
    raise exception '0236 rollback self-check: claim_farah_free_message is still there';
  end if;
  if to_regprocedure('public.commit_farah_free_claim(uuid, uuid, integer)') is not null then
    raise exception '0236 rollback self-check: commit_farah_free_claim is still there';
  end if;
  if to_regprocedure('public.release_farah_free_claim(uuid, uuid)') is not null then
    raise exception '0236 rollback self-check: release_farah_free_claim is still there';
  end if;
  if to_regclass('public.farah_free_claims') is not null then
    raise exception '0236 rollback self-check: farah_free_claims is still there';
  end if;
end
$check$;
