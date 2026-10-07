-- ROLLBACK for 0240 (is_qa_account and the four surfaces that use it). Not a migration: it is the exact undo, kept beside the file it undoes so it is reviewed in the same diff and so nobody has to reconstruct it under
-- pressure. Run it as `postgres` in the SQL Editor, in ONE transaction (it is written to be). To keep what the schema ledger says honest, record it as a NEW migration (do not delete 0240's ledger row).
-- `supabase/rollbacks/` is outside supabase/migrations, so neither the migration-numbering check nor `supabase db push` ever sees it.
--
-- HOW: the same patch table as the migration with every anchor and replacement swapped, patching the LIVE definitions the same way (each replacement must be found exactly once, or it stops). So it removes only the
-- predicate 0240 added and keeps any change that landed since. ORDER MATTERS: the four functions lose the predicate first (so nothing refers to is_qa_account any more), then the function is dropped. Dropping it first
-- would fail on the dependency, which is the intended safety.
--
-- WHAT IT CHANGES: from the moment it runs QA accounts are no longer hidden from the Talent Directory, the portfolio read, the contact gate or the leaderboard. Nothing is deleted; no row is touched.

begin;

create or replace function pg_temp.patch_fn(p_sig text, p_pairs text[], p_undo boolean default false) returns void
language plpgsql as $patch$
declare
  v_oid oid := to_regprocedure(p_sig);
  v_def text;
  v_new text;
  v_cnt integer;
  i integer;
begin
  if v_oid is null then raise exception '0240 rollback: function % not found', p_sig; end if;
  v_def := pg_get_functiondef(v_oid);
  v_new := v_def;
  i := 1;
  while i <= array_length(p_pairs, 1) loop
    if p_undo or position(p_pairs[i + 1] in v_new) = 0 then
      v_cnt := (length(v_new) - length(replace(v_new, p_pairs[i], ''))) / length(p_pairs[i]);
      if v_cnt <> 1 then
        raise exception '0240 rollback: anchor % found % times in % (it must be found exactly once)', quote_literal(p_pairs[i]), v_cnt, p_sig;
      end if;
      v_new := replace(v_new, p_pairs[i], p_pairs[i + 1]);
    end if;
    i := i + 2;
  end loop;
  if v_new <> v_def then execute v_new; end if;
end
$patch$;

select pg_temp.patch_fn($x$public.talent_directory_listed_ids()$x$, array[
    $x$and p.deletion_requested_at is null and not public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name)$x$,
    $x$and p.deletion_requested_at is null$x$
  ], true);
select pg_temp.patch_fn($x$public.talent_directory_portfolio_items(uuid)$x$, array[
    $x$and p.deletion_requested_at is null and not public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name)$x$,
    $x$and p.deletion_requested_at is null$x$
  ], true);
select pg_temp.patch_fn($x$public.request_talent_directory_contact(uuid, uuid, text, uuid)$x$, array[
    $x$and p.deletion_requested_at is null and not public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name)$x$,
    $x$and p.deletion_requested_at is null$x$
  ], true);
select pg_temp.patch_fn($x$public.referral_leaderboard(timestamptz, timestamptz, integer)$x$, array[
    $x$and p.deletion_requested_at is null and not public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name)$x$,
    $x$and p.deletion_requested_at is null$x$
  ], true);

drop function public.is_qa_account(text, text, text, text);

commit;
