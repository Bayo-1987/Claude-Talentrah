-- 0252: a Farah paid-message hold can be refunded at most once (FARAH-PAID-HOLD-SWEEP, step 1: the guard).
--
-- WHY. #908 makes a PAID Farah message take its credit at the check (spend_credits_atomic, one ledger row of -1 whose related_entity_id is a per-message hold id) and give it back (grant_credits_atomic, a ledger row of +1
-- with the SAME related_entity_id) on every exit that is not a completed reply. A process killed between the two leaves the credit taken; the owner's condition is that this must not depend on someone noticing. A daily
-- sweep will refund each orphaned hold (a spend with no refund and no completion marker) exactly once. "Once" has to hold even when two sweeps run together (the cron and a manual POST) and when the route's own release
-- races a sweep: a read-then-refund in code cannot promise that. This index can. grant_credits_atomic updates the balance and inserts the ledger row inside ONE function, so a second +1 row for the same hold id raises
-- 23505 and the whole call rolls back, including the balance increase; the caller treats 23505 as "already refunded". It is the same mechanism as ad_wallet_ledger_topup_reference_idx (0050).
--
-- WHAT IT ADDS: one partial unique index on public.credit_ledger (related_entity_id) where reason = 'farah_chat_message' and delta > 0 and related_entity_id is not null. Nothing else.
--   * It applies ONLY to positive rows of that one reason that carry an id. The hold's own spend row (delta < 0) shares the id and is not in the index. Every other reason (purchases, referral rewards, admin
--     adjustments) is outside the predicate, so a repeated related_entity_id there is unaffected. A refund written without an id (nothing in the application does that) is unaffected too.
--   * Rows that exist today: refunds with this reason cannot exist yet (the application only ever wrote -1 rows for farah_chat_message before #908), and the migration's self-check proves it before keeping the index.
--
-- PER-REQUEST COST. Server work per request: none added. One extra index entry for a refund row, which is written only when a paid message does not complete. credit_ledger is small (hundreds of rows); the build takes a brief
-- lock on the table, which is fine at this size.
--
-- ADDITIVE for the running app: nothing deployed fails because an index exists. Applied BEFORE the code that depends on it merges. The exact undo is supabase/rollbacks/0252_farah_hold_refund_once.rollback.sql.

-- Self-check, first half: the index cannot be built over duplicates, so say so plainly rather than with a bare 23505.
do $pre$
begin
  if exists (
    select 1
      from public.credit_ledger
     where reason = 'farah_chat_message' and delta > 0 and related_entity_id is not null
     group by related_entity_id
    having count(*) > 1
  ) then
    raise exception '0252: two refunds already share a Farah hold id; resolve them before this migration';
  end if;
end
$pre$;

create unique index if not exists credit_ledger_farah_hold_refund_once_idx
  on public.credit_ledger (related_entity_id)
  where reason = 'farah_chat_message' and delta > 0 and related_entity_id is not null;

comment on index public.credit_ledger_farah_hold_refund_once_idx is
  '0252: at most one refund (+delta) per Farah paid-message hold id. grant_credits_atomic raises 23505 on a second one and rolls back whole; the paid-hold sweep treats that as already refunded.';

-- Self-check, second half: the index exists, is unique, and is exactly the partial one described (not a plain unique index on related_entity_id, which would break every other reason).
do $check$
declare
  v_def text;
begin
  select pg_get_indexdef(i.indexrelid) into v_def
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname = 'credit_ledger_farah_hold_refund_once_idx' and i.indrelid = 'public.credit_ledger'::regclass and i.indisunique;
  if v_def is null then
    raise exception '0252: the unique index is not there';
  end if;
  if v_def not like '%(related_entity_id)%' or v_def not like '%farah_chat_message%' or v_def not like '%delta > 0%' or v_def not like '%related_entity_id IS NOT NULL%' then
    raise exception '0252: the index is not the partial index described: %', v_def;
  end if;
end
$check$;
