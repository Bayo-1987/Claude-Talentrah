-- ROLLBACK for 0251 (the owner's test accounts as QA accounts). Not a migration: the exact undo, kept beside the file it undoes so it is reviewed in the same diff. Run it as `postgres` in ONE transaction (it is written to be).
-- It puts public.is_qa_account back to its 0240 definition, clause for clause. Nothing is deleted and no row is touched. From the moment it runs, the owner's stonebridgehibr1+<tag>@gmail.com accounts are no longer treated as QA accounts by the
-- Talent Directory, the portfolio read, the contact gate, the leaderboard and the employer widget (they come back into those surfaces if they appear there). ACL, owner and comment are restored; the four callers are not touched.
begin;

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

-- Self-check: the owner's plus-addresses are no longer QA; the 0240 behaviour is intact; the four callers still exist.
do $check$
begin
  if public.is_qa_account('stonebridgehibr1+test@gmail.com', null, null, null) then raise exception '0251 rollback: the owner pattern is still a QA account'; end if;
  if not public.is_qa_account('hello+qa-seeker@talentrah.com', null, null, null) then raise exception '0251 rollback: the +qa- rule was lost'; end if;
  if not public.is_qa_account('real@example.com', 'QA', 'Seeker', null) or public.is_qa_account('real@example.com', 'Qasim', null, null) then raise exception '0251 rollback: the name rule is not the 0240 one'; end if;
  if has_function_privilege('anon', 'public.is_qa_account(text, text, text, text)', 'EXECUTE') or has_function_privilege('authenticated', 'public.is_qa_account(text, text, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.is_qa_account(text, text, text, text)', 'EXECUTE') then raise exception '0251 rollback: ACL is not service_role only'; end if;
  if to_regprocedure('public.talent_directory_listed_ids()') is null or to_regprocedure('public.referral_leaderboard(timestamptz, timestamptz, integer)') is null then raise exception '0251 rollback: a caller of is_qa_account is missing'; end if;
end
$check$;
commit;
