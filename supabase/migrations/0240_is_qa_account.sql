-- 0240: one rule for "this is a QA account", and the four database surfaces that must not show one: Talent Directory listing, portfolio read, contact-request gate, and the referral leaderboard.
--
-- WHY. QA accounts now exist on production (4 of 29 profiles on 7 Oct 2026). A QA account that lists itself in the Talent Directory or opts in to the leaderboard would be shown to real employers and real seekers as if it were
-- a person. S1's TypeScript helper hides QA accounts from the surfaces the application reads; the surfaces below are read inside the database (the directory's count, preview, paid search and portfolio all start from
-- talent_directory_listed_ids(), the leaderboard is one function), so the rule has to live there too, once, and be the same rule. Measured before this was written (7 Oct 2026, read only): production 4 QA accounts, 1 profile listed in the
-- directory (not a QA account), 0 on the leaderboard; preview 0 QA accounts. So this changes no visible row on day one: it is a guard for the day a QA account lists itself or opts in.
--
-- THE RULE (agreed with S1 and the CTO; case-sensitive for names, case-insensitive for the email tag; "trimmed" means spaces at either end):
--   the email contains '+qa-' (any case), or
--   the first name, the full name (first + last, the parts that are not empty, joined by one space) or the leaderboard display name is exactly 'QA' or starts with 'QA ' (capital Q, capital A, then a space).
--   'Qasim', 'Qa Hoang' and 'QAnon' are NOT QA accounts.
-- public.is_qa_account(email, first_name, last_name, display_name) is IMMUTABLE, takes only its four arguments, reads no table, and is NULL-safe (a null argument is just "no match"; the function never returns null).
-- It is SECURITY INVOKER with an empty search_path (every name inside is pg_catalog-qualified). EXECUTE is for service_role only: the four functions below are SECURITY DEFINER and call it as their owner, and no policy
-- or client call needs it, so it is not offered to anon or authenticated.
--
-- WHAT IS PATCHED, AND HOW. Exactly the way 0212 added its own predicate: each function is patched FROM ITS LIVE DEFINITION (pg_get_functiondef), the anchor must be found exactly once, and one predicate is added after it:
--   and p.deletion_requested_at is null   ->   and p.deletion_requested_at is null and not public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name)
-- in talent_directory_listed_ids(), talent_directory_portfolio_items(uuid), request_talent_directory_contact(uuid, uuid, text, uuid) and referral_leaderboard(timestamptz, timestamptz, integer). Nothing else in any of them
-- changes: SECURITY DEFINER, the pinned search_path (public), the owner and the grants are kept (CREATE OR REPLACE keeps the ACL; the header comes from the live definition). The preflight on preview and production
-- (7 Oct 2026) found each function present once, the anchor exactly once, and identical live definitions on both projects (def sha256 b3d5b30d…, 0bf70562…, 017d4a6a…, c17f500c…).
-- talent_directory_listed_count, talent_directory_preview, talent_directory_preview_for and talent_directory_search call talent_directory_listed_ids() and inherit the exclusion; no row level security policy refers to
-- any of these columns or functions (0 found), so there is no policy to patch.
--
-- PER-REQUEST COST. Server work per request: none added. The leaderboard already reads each candidate's row from profiles (p) to test its opt-in and deletion flag; the predicate reads three more columns of that same row, so
-- no extra join, no extra row and no extra query, and LIMIT p_limit stays in SQL. The directory functions likewise already read p. The rule itself is a few string comparisons per candidate row.
--
-- ADDITIVE for the running app: a new function, and added predicates that are true for every account that is not a QA account. Applied to production BEFORE the merge, after a rolled-back dry run and the owner's yes
-- (personal data is read by these functions). The exact undo is supabase/rollbacks/0240_is_qa_account.rollback.sql.

create or replace function public.is_qa_account(p_email text, p_first text, p_last text, p_display text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $f$
  select
    coalesce(pg_catalog.lower(p_email) like '%+qa-%', false)
    or coalesce(pg_catalog.btrim(p_first) = 'QA' or pg_catalog.left(pg_catalog.btrim(p_first), 3) = 'QA ', false)
    or coalesce(
         pg_catalog.btrim(pg_catalog.concat_ws(' ', nullif(pg_catalog.btrim(p_first), ''), nullif(pg_catalog.btrim(p_last), ''))) = 'QA'
         or pg_catalog.left(pg_catalog.btrim(pg_catalog.concat_ws(' ', nullif(pg_catalog.btrim(p_first), ''), nullif(pg_catalog.btrim(p_last), ''))), 3) = 'QA ',
         false)
    or coalesce(pg_catalog.btrim(p_display) = 'QA' or pg_catalog.left(pg_catalog.btrim(p_display), 3) = 'QA ', false);
$f$;
revoke execute on function public.is_qa_account(text, text, text, text) from public, anon, authenticated;
grant execute on function public.is_qa_account(text, text, text, text) to service_role;
comment on function public.is_qa_account(text, text, text, text) is
  '0240: true for a QA account (email contains +qa-, or first name / full name / leaderboard display name is exactly QA or starts with "QA "). Pure and immutable; service_role only. The Talent Directory and leaderboard functions call it as their owner.';

-- The helper below lives in pg_temp: it exists for this migration's own session only and leaves nothing behind. It is the one 0212 used (see 0212 section 10 for the full reasoning), with its messages renumbered.
create or replace function pg_temp.patch_fn(p_sig text, p_pairs text[], p_undo boolean default false) returns void
language plpgsql as $patch$
declare
  v_oid oid := to_regprocedure(p_sig);
  v_def text;
  v_new text;
  v_cnt integer;
  i integer;
begin
  if v_oid is null then raise exception '0240: function % not found', p_sig; end if;
  v_def := pg_get_functiondef(v_oid);
  v_new := v_def;
  i := 1;
  while i <= array_length(p_pairs, 1) loop
    -- Applying is idempotent: a replacement that is already there (it contains its own anchor) means this pair was applied. UNDOING is not: the original text is a part of what the patch left,
    -- so "is the replacement present" proves nothing, and the undo requires its anchor exactly once or stops.
    if p_undo or position(p_pairs[i + 1] in v_new) = 0 then
      v_cnt := (length(v_new) - length(replace(v_new, p_pairs[i], ''))) / length(p_pairs[i]);
      if v_cnt <> 1 then
        raise exception '0240: anchor % found % times in % (it must be found exactly once)', quote_literal(p_pairs[i]), v_cnt, p_sig;
      end if;
      v_new := replace(v_new, p_pairs[i], p_pairs[i + 1]);
    end if;
    i := i + 2;
  end loop;
  if v_new <> v_def then execute v_new; end if;
end
$patch$;

select pg_temp.patch_fn($x$public.talent_directory_listed_ids()$x$, array[
    $x$and p.deletion_requested_at is null$x$,
    $x$and p.deletion_requested_at is null and not public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name)$x$
  ], false);
select pg_temp.patch_fn($x$public.talent_directory_portfolio_items(uuid)$x$, array[
    $x$and p.deletion_requested_at is null$x$,
    $x$and p.deletion_requested_at is null and not public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name)$x$
  ], false);
select pg_temp.patch_fn($x$public.request_talent_directory_contact(uuid, uuid, text, uuid)$x$, array[
    $x$and p.deletion_requested_at is null$x$,
    $x$and p.deletion_requested_at is null and not public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name)$x$
  ], false);
select pg_temp.patch_fn($x$public.referral_leaderboard(timestamptz, timestamptz, integer)$x$, array[
    $x$and p.deletion_requested_at is null$x$,
    $x$and p.deletion_requested_at is null and not public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name)$x$
  ], false);
