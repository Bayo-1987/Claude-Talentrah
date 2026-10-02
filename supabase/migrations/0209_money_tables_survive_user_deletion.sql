-- 0209: deleting a user must not delete their financial or counterparty records.
--
-- THE RISK THAT EXISTS TODAY, independent of any "delete my account" feature. Every one of these foreign keys into `profiles` is
-- ON DELETE CASCADE, so removing a profile (a hand delete in the Supabase dashboard, `auth.admin.deleteUser`, a future purge) silently
-- wipes the person's payment transactions, credit ledger, Passes, the referral rows that decide SOMEONE ELSE'S reward, and the mentorship
-- sessions and reviews that are also the mentor's records. Tax and audit records, and other people's records, must outlive the account.
--
--   payment_transactions.user_id        credit_ledger.user_id            user_passes.user_id
--   referral_reward_events.referrer_id  referral_reward_events.referred_user_id
--   referrals.referrer_id               referrals.referred_user_id (already nullable)
--   mentorship_sessions.mentee_id       mentorship_reviews.reviewer_id
--
-- WHAT CHANGES. Each FK becomes ON DELETE SET NULL and its column becomes nullable. These tables hold nothing about a person except that
-- user id plus references (Paystack reference, amounts, product ids), so nulling it IS the anonymisation: the row stays for tax and audit,
-- detached from name and email. (mentorship_sessions.mentee_notes, the mentee's own free text, is nulled in the same UPDATE, below.) Verified against the production catalog before writing this:
--   - no UPDATE-blocking trigger exists on any of these tables; credit_ledger's only trigger fires on INSERT; mentorship_sessions has a
--     BEFORE UPDATE trigger (enforce_mentorship_session_notes_ownership) that only compares auth.uid() when a NOTES column changes, and the
--     SET NULL changes only the id column, so it never raises, whether auth.uid() is null (service role / GoTrue) or not (proved on a real
--     cascade in both cases, see the PR). One consequence worth stating: once mentee_id is null that guard cannot attribute the mentee's notes
--     to anyone (`auth.uid() <> null` is null, never true), so this migration ALSO makes the mentee's free-text notes go with the account:
--     the same function nulls mentee_notes in the very UPDATE that detaches the mentee. The session row keeps everything the mentor needs;
--   - referrals.referred_user_id's UNIQUE index allows nulls; nothing else constrains these columns beyond the FKs being replaced.
--
-- A payment that arrives for a user who no longer exists has nowhere to be granted. fulfillPayment now verifies it with Paystack and, when it
-- really was paid, records it as `needs_refund` (a new payment_status value, added here) and alerts the operator, instead of crediting
-- nobody. `needs_refund` is added first and is not used by anything else in this migration (a new enum value cannot be used in the
-- transaction that adds it).
--
-- ALSO ADDED: account_deletion_fk_catalog(), a service-role-only read of every foreign key into profiles / auth.users with its delete rule
-- and nullability, so tests can assert the rule from the catalog instead of from a comment (and the account-deletion work's FK-catalog test
-- has something to read; supabase-js cannot query pg_catalog).
--
-- ADDITIVE IN EFFECT for the running code (no column is dropped, no policy narrowed), so it is applied to production BEFORE the merge, after
-- a dry run (production row counts per table before and after, inside BEGIN ... ROLLBACK) and the owner's yes. The generated types are
-- updated in the same PR.

alter type public.payment_status add value if not exists 'needs_refund';

-- payment_transactions.user_id
alter table public.payment_transactions alter column user_id drop not null;
alter table public.payment_transactions drop constraint payment_transactions_user_id_fkey;
alter table public.payment_transactions
  add constraint payment_transactions_user_id_fkey foreign key (user_id) references public.profiles(id) on delete set null;

-- credit_ledger.user_id
alter table public.credit_ledger alter column user_id drop not null;
alter table public.credit_ledger drop constraint credit_ledger_user_id_fkey;
alter table public.credit_ledger
  add constraint credit_ledger_user_id_fkey foreign key (user_id) references public.profiles(id) on delete set null;

-- user_passes.user_id
alter table public.user_passes alter column user_id drop not null;
alter table public.user_passes drop constraint user_passes_user_id_fkey;
alter table public.user_passes
  add constraint user_passes_user_id_fkey foreign key (user_id) references public.profiles(id) on delete set null;

-- referral_reward_events (both sides)
alter table public.referral_reward_events alter column referrer_id drop not null;
alter table public.referral_reward_events alter column referred_user_id drop not null;
alter table public.referral_reward_events drop constraint referral_reward_events_referrer_id_fkey;
alter table public.referral_reward_events drop constraint referral_reward_events_referred_user_id_fkey;
alter table public.referral_reward_events
  add constraint referral_reward_events_referrer_id_fkey foreign key (referrer_id) references public.profiles(id) on delete set null;
alter table public.referral_reward_events
  add constraint referral_reward_events_referred_user_id_fkey foreign key (referred_user_id) references public.profiles(id) on delete set null;

-- referrals (both sides; referred_user_id was already nullable)
alter table public.referrals alter column referrer_id drop not null;
alter table public.referrals drop constraint referrals_referrer_id_fkey;
alter table public.referrals drop constraint referrals_referred_user_id_fkey;
alter table public.referrals
  add constraint referrals_referrer_id_fkey foreign key (referrer_id) references public.profiles(id) on delete set null;
alter table public.referrals
  add constraint referrals_referred_user_id_fkey foreign key (referred_user_id) references public.profiles(id) on delete set null;

-- mentorship_sessions.mentee_id (the mentor's record of the session outlives the mentee)
alter table public.mentorship_sessions alter column mentee_id drop not null;
alter table public.mentorship_sessions drop constraint mentorship_sessions_mentee_id_fkey;
alter table public.mentorship_sessions
  add constraint mentorship_sessions_mentee_id_fkey foreign key (mentee_id) references public.profiles(id) on delete set null;

-- mentorship_reviews.reviewer_id (the mentor's reputation outlives the reviewer)
alter table public.mentorship_reviews alter column reviewer_id drop not null;
alter table public.mentorship_reviews drop constraint mentorship_reviews_reviewer_id_fkey;
alter table public.mentorship_reviews
  add constraint mentorship_reviews_reviewer_id_fkey foreign key (reviewer_id) references public.profiles(id) on delete set null;

-- The mentee's own free text leaves with the mentee ------------------------------------------------------------------------------------
create or replace function public.enforce_mentorship_session_notes_ownership()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  -- The mentee's account is gone (the FK just set mentee_id to null): their notes go with it. This is the anonymisation of the one free-text
  -- column on the row; the session itself, its price and its mentor-side notes stay.
  if old.mentee_id is not null and new.mentee_id is null then
    new.mentee_notes := null;
    return new;
  end if;
  if new.mentee_notes is distinct from old.mentee_notes and auth.uid() <> old.mentee_id then
    raise exception 'NOT_YOUR_NOTES: only the mentee may change mentee_notes';
  end if;
  if new.mentor_notes is distinct from old.mentor_notes and auth.uid() <> old.mentor_id then
    raise exception 'NOT_YOUR_NOTES: only the mentor may change mentor_notes';
  end if;
  return new;
end;
$function$;

-- The catalog read ------------------------------------------------------------------------------------------------------------------
create or replace function public.account_deletion_fk_catalog()
returns table (child_table text, child_column text, parent_table text, on_delete text, nullable boolean)
language sql
stable
security definer
set search_path = ''
as $$
  -- Names are returned unqualified for the public schema and qualified otherwise ('profiles', 'payment_transactions', 'auth.users'): with search_path pinned
  -- to '' a bare regclass cast would print 'public.profiles', which is not what a test (or a person) should have to match.
  select
    case when cn.nspname = 'public' then cc.relname::text else cn.nspname::text || '.' || cc.relname::text end as child_table,
    a.attname::text as child_column,
    case when pn.nspname = 'public' then pc.relname::text else pn.nspname::text || '.' || pc.relname::text end as parent_table,
    case c.confdeltype
      when 'a' then 'NO ACTION' when 'r' then 'RESTRICT' when 'c' then 'CASCADE' when 'n' then 'SET NULL' when 'd' then 'SET DEFAULT'
    end as on_delete,
    not a.attnotnull as nullable
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_class cc on cc.oid = c.conrelid
  join pg_catalog.pg_namespace cn on cn.oid = cc.relnamespace
  join pg_catalog.pg_class pc on pc.oid = c.confrelid
  join pg_catalog.pg_namespace pn on pn.oid = pc.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
  where c.contype = 'f'
    and c.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
$$;

comment on function public.account_deletion_fk_catalog() is
  'Every foreign key into public.profiles / auth.users with its delete rule and nullability (0209). Service role only; read by tests, never by the app.';

revoke all on function public.account_deletion_fk_catalog() from public, anon, authenticated;
grant execute on function public.account_deletion_fk_catalog() to service_role;
