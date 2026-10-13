-- 0251 (number confirmed by the owner, 9 Oct 2026): the owner's own test accounts count as QA accounts (SIGNUPS-REVIEW 3).
--
-- WHY. The owner signs up test accounts from his own mailbox, as stonebridgehibr1+<tag>@gmail.com with the name "Amara Test". They are not people, but they look like real signups. The QA rule (0240, public.is_qa_account) only knows
-- "+qa-" in the email and names starting with "QA ", so these are not covered. This adds ONE clause to that function and changes nothing else.
--
-- THE NEW CLAUSE (value-pinned, no wildcard that could match anyone else): the whole email, lower-cased and trimmed of spaces, matches
--     ^stonebridgehibr1\+[a-z0-9._-]+@gmail\.com$
-- that is: the mailbox "stonebridgehibr1", then a plus sign, then a NON-EMPTY tag of letters, digits, dot, underscore or hyphen, then exactly "@gmail.com". Nothing before it, nothing after it. A plus-address of that mailbox can only ever receive mail for the
-- mailbox owner, so an account that signed up with one is the owner's by construction: that is why the EMAIL alone is enough and is what is pinned.
--   NOT matched, on purpose: the bare mailbox stonebridgehibr1@gmail.com (the owner's own real account, which may be an admin or a real user: the owner has not asked for it); any other mailbox (stonebridgehibr12+x@..., xstonebridgehibr1+x@...); any other domain
--   (@googlemail.com, @gmail.com.evil.test, @gmail.co); an empty tag (stonebridgehibr1+@gmail.com); a second @. Gmail ignores dots in the mailbox part, so stonebridge.hibr1+x@gmail.com is the same inbox but is NOT matched (the owner writes the mailbox without dots).
--
-- THE NAME "Amara Test" IS DELIBERATELY NOT A RULE OF ITS OWN. A name is typed by whoever signs up: a real person could be called Amara Test, and a rule on the name alone would hide a real person from the directory and the leaderboard, which is
-- the exact failure the case-sensitive "QA " rule was built to avoid. Name AND email together add no safety over the email alone (the email already proves it is his). If the owner wants the name pinned too (for accounts made from a different mailbox),
-- that is a separate decision; the read in qa-extension-impact-count.sql shows how many accounts that would touch before anyone decides.
--
-- WHAT STAYS THE SAME: the signature (text, text, text, text), IMMUTABLE, PARALLEL SAFE, SECURITY INVOKER, empty search_path, EXECUTE for service_role only (CREATE OR REPLACE keeps the ACL; the two lines below restate it). Every clause of 0240 is kept
-- byte for byte; the new clause is added after the first one. The four SECURITY DEFINER functions of 0240 and the employer widget (0237) call this function by name, so they pick the new rule up without being touched.
--
-- WHAT THIS DOES NOT DO, AND WHAT STILL HAS TO BE DONE IN CODE. /admin/people/signups reads public.profiles directly (src/lib/admin/people/queries.ts: listSignups, countSignupsSince) and applies NO QA rule at all today, for "+qa-" accounts either.
-- So after this migration those accounts disappear from the directory, portfolio read, contact gate, leaderboard and the employer widget, and from product analytics only once the TypeScript twin (src/lib/profile/qa-account.ts) gets the same clause, but they STAY in the
-- signup list until that list is changed to apply the rule. That change (the twin plus a filter in the signup queries) is S3's later work, not this migration.
--
-- ADDITIVE for the running app: the function is replaced by one that returns true for strictly more inputs (only the pinned pattern). Applied BEFORE the merge, after a rolled-back dry run and the owner's yes (docs/production-migration-apply.md). Exact undo:
-- supabase/rollbacks/0251_is_qa_account_owner_test_accounts.rollback.sql.

create or replace function public.is_qa_account(p_email text, p_first text, p_last text, p_display text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $f$
  select
    coalesce(pg_catalog.lower(p_email) like '%+qa-%', false)
    or coalesce(pg_catalog.lower(pg_catalog.btrim(p_email)) ~ '^stonebridgehibr1\+[a-z0-9._-]+@gmail\.com$', false)
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
  '0251 (amends 0240): true for a QA account (email contains +qa-, or is exactly stonebridgehibr1+<tag>@gmail.com, or first name / full name / leaderboard display name is exactly QA or starts with "QA "). Pure and immutable; service_role only.';

-- Self-check: the migration fails (and nothing is kept) unless every pinned case behaves. TRUE cases first, then the FALSE ones that must stay false, then the 0240 cases that must be unchanged.
do $check$
declare
  c record;
begin
  for c in select * from (values
    ('stonebridgehibr1+test@gmail.com', null, null, null, true),
    ('stonebridgehibr1+a.b_c-d9@gmail.com', null, null, null, true),
    ('StoneBridgeHibr1+Amara@GMAIL.COM', null, null, null, true),
    ('  stonebridgehibr1+x@gmail.com  ', null, null, null, true),
    ('stonebridgehibr1+test@gmail.com', 'Amara', 'Test', null, true),
    ('stonebridgehibr1@gmail.com', 'Amara', 'Test', null, false),
    ('stonebridgehibr1+@gmail.com', null, null, null, false),
    ('stonebridgehibr12+x@gmail.com', null, null, null, false),
    ('xstonebridgehibr1+x@gmail.com', null, null, null, false),
    ('stonebridge.hibr1+x@gmail.com', null, null, null, false),
    ('stonebridgehibr1+x@googlemail.com', null, null, null, false),
    ('stonebridgehibr1+x@gmail.co', null, null, null, false),
    ('stonebridgehibr1+x@gmail.com.evil.test', null, null, null, false),
    ('stonebridgehibr1+x@evilgmail.com', null, null, null, false),
    ('stonebridgehibr1+x@y@gmail.com', null, null, null, false),
    ('stonebridgehibr1+x y@gmail.com', null, null, null, false),
    ('stonebridgehibr1+x@gmail.com', null, null, null, true),
    ('someone@example.com', 'Amara', 'Test', null, false),
    ('hello+qa-seeker@talentrah.com', null, null, null, true),
    ('hello+QA-Employer@talentrah.com', null, null, null, true),
    ('real@example.com', 'QA', 'Seeker', null, true),
    ('real@example.com', 'Qasim', null, null, false),
    ('real@example.com', 'Qa', 'Hoang', null, false),
    ('real@example.com', 'QAnon', null, null, false),
    ('real@example.com', null, null, 'QA Mentor', true),
    (null, null, null, null, false)
  ) as t(e, f, l, d, want)
  loop
    if public.is_qa_account(c.e, c.f, c.l, c.d) is distinct from c.want then
      raise exception '0251: is_qa_account(%, %, %, %) returned %, expected %', c.e, c.f, c.l, c.d, public.is_qa_account(c.e, c.f, c.l, c.d), c.want;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.is_qa_account(text, text, text, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.is_qa_account(text, text, text, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.is_qa_account(text, text, text, text)', 'EXECUTE') then
    raise exception '0251: is_qa_account must be executable by service_role only';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = 'public.is_qa_account(text, text, text, text)'::regprocedure and p.provolatile = 'i' and not p.prosecdef and p.proconfig = array['search_path=""']) then
    raise exception '0251: is_qa_account must stay immutable, SECURITY INVOKER with an empty search_path';
  end if;
end
$check$;
