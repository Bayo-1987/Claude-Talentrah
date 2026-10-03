-- 0215 — A referral pays when the friend ACTIVATES, not when they sign up (docs/referrals-open-questions.md #2, decided 2026-10-02).
--
-- Today a referral pays in two halves: 10 credits the moment a referred account exists (handle_new_user), 40 more at activation
-- (check_and_activate_referral): 50 in all, 2 resume tailorings plus change. The signup half needs no activity, no confirmation and no
-- rate limit, so it was the gameable part (50 credits per 30 days for ten disposable addresses, bounded only by the cap). It stops
-- here: a signup pays NOTHING, and activation pays the whole reward.
--
-- THE TOTAL PER ACTIVATED REFERRAL IS UNCHANGED (50): honest referrers end up no worse off. Because the amount is no longer a fixed 40, the
-- activation step pays "the reward minus whatever this referral has already been paid" (referrals.reward_credits_referrer):
--   * a referral made under the new rule has been paid 0, so it gets 50;
--   * a referral that signed up BEFORE this migration was already paid its 10-credit signup half, so it gets the remainder, 40:
--     no double payment, and no clawback of anything already earned;
--   * a referral whose signup half was withheld by the cap (paid 0) gets 50, subject to the cap again at activation.
-- Self-referral detection (0036) in handle_new_user is untouched.
--
-- WHAT THE CAP COUNTS AFTER THIS MIGRATION (grant_referral_reward -> count_rewarded_referrals_last_30d, unchanged): the number of DISTINCT REFERRALS that have had any
-- reward credited to the referrer in the last 30 days (ledger rows with reason referral_signup_bonus or referral_activation_bonus, grouped by the referral they belong
-- to), with the referral being paid excluded from its own count. A legacy referral paid 10 at signup and 40 at activation has TWO ledger rows but ONE referral id, so it
-- counts ONCE: tests/referrals/referrals.test.ts ("one referral never counts twice against the cap"). Under the new rule each referral has exactly one grant.
--
-- THE ATOMIC CLAIM. The activation used to be "select ... where status = 'signed_up'", later "update ... set status = 'activated'", then the grant: two concurrent calls could
-- both pass the select and both pay. The update is now the claim itself (`where id = ... and status = 'signed_up'`, and the function stops if it claimed nothing): the second
-- concurrent caller blocks on the row lock until the first commits, re-evaluates the predicate, sees 'activated', updates zero rows and returns, so exactly one caller pays.
-- (CLAUDE.md: anything that gates on a compared value must check and act in one statement.) Proved by a DB-backed concurrency test.
--
-- WHY A WITHHELD REWARD IS RECORDED, NOT DERIVED. "Activated and paid less than 50" cannot say why, and goes wrong the day the amount changes. The function that decides
-- not to pay writes the reason on the referral itself, and /refer reads it: `referrals.reward_withheld_reason`, nullable, NULL meaning "not withheld". Every path that can
-- leave an ACTIVATED referral paid less than the whole reward, found by reading the three functions and 0209's foreign keys:
--   1. THE CAP. grant_referral_reward returns without paying when the referrer already has 10 rewarded referrals in the rolling 30 days. It now writes 'cap' on that
--      referral first. (The referral is still activated: the friend did activate, and the leaderboard counts it.)
--   2. A DELETED REFERRER. 0209 made referrals.referrer_id ON DELETE SET NULL, so a referral can outlive its referrer with referrer_id null. Until now the friend's activation
--      called grant_referral_reward(null, ...), grant_credits_atomic found no profile and RAISED, and because the activation runs inside the friend's own resumes/applications
--      trigger, THE FRIEND'S SAVE OR APPLY FAILED. Found while listing these paths. There is nobody to pay and nobody to tell, so the referral is claimed (activated) and
--      marked 'referrer_deleted' without paying, and the friend's action succeeds.
--      'referrer_deleted' means the referrer is ACTUALLY GONE (referrer_id is null after a hard delete). A referrer who is only PENDING deletion (account deletion,
--      S3-21: still able to restore) still has referrer_id set and is paid normally; the decision is the owner's (2026-10-03), and nothing in this migration may key on
--      a pending flag.
--   3. A FAILED GRANT (grant_credits_atomic raising for any other reason). The claim and the grant run in their own subtransaction (a BEGIN ... EXCEPTION block in
--      check_and_activate_referral): on any error it rolls back, claim included, so the referral stays 'signed_up' and never becomes an activated, underpaid row; a
--      WARNING names the referral and the SQLSTATE; and the function returns normally, so THE FRIEND'S OWN SAVE OR APPLICATION STILL SUCCEEDS (owner's decision,
--      2026-10-03; before this a referrer-side failure turned into an error on the friend's resume save or job application). Nothing schedules a retry, and nothing
--      needs to: both triggers (resumes_check_activation, applications_check_activation) call the function again on the friend's next base-resume save or application.
--      The block catches everything, including a lock timeout or deadlock: all of them mean "not paid now, try again at the next event".
--   4. A REFERRAL ALREADY PAID IN FULL (remainder <= 0): nothing is owed, so it is not "withheld" and the reason stays NULL.
-- LEGACY ROWS ARE NOT BACKFILLED: a referral withheld by the cap before this migration has no recorded reason (production has none: its one referral is still signed_up).
-- /refer shows such a row as what it is (activated, paid N credits) without claiming a reason it cannot prove.
--
-- THE HARDENING 0211 APPLIED IS KEPT. CREATE OR REPLACE keeps a function's grants but replaces its SET options and security mode with the new text, so each redefinition below
-- repeats `security definer set search_path to 'public'` exactly as production has it (proconfig {search_path=public}, prosecdef true), and this migration contains no GRANT or
-- REVOKE. The self-checks at the end compare every touched function's ACL and config with what they were when the migration started, and fail if any moved.
--
-- THE 50 IS A LITERAL, as the 10 and 40 were: Postgres cannot import a TypeScript constant. src/lib/referrals/rewards.ts (REFERRAL_REWARD_CREDITS) is the other half, and
-- tests/referrals/referrals.test.ts reads the amount the live trigger really grants and compares it, so a future repricing that forgets one side fails there.
--
-- Three functions are rewritten in full (0036/0092's convention). Everything not named above is byte-identical to the definition live on production (confirmed with
-- pg_get_functiondef): handle_new_user keeps the referrer lookup, the self-referral check, the name handling and the profile insert, and loses only the signup grant;
-- grant_referral_reward changes only its cap branch.

-- The functions' ACL and config as they are NOW, kept for the self-checks at the end. A session setting rather than a temp table: it survives whether the
-- runner wraps the file in one transaction (production and the owner's apply do) or applies it statement by statement (a temp table "on commit drop" would
-- vanish after its own statement there).
select set_config('migration.m0215_before', coalesce((
  select jsonb_agg(jsonb_build_object('fn', p.oid::regprocedure::text, 'acl', p.proacl::text, 'config', p.proconfig::text, 'secdef', p.prosecdef))::text
  from pg_proc p
  where p.oid in (
    'public.handle_new_user()'::regprocedure,
    'public.check_and_activate_referral(uuid)'::regprocedure,
    'public.grant_referral_reward(uuid, uuid, integer, credit_reason)'::regprocedure
  )
), '[]'), false);

-- Why a reward was withheld: written by the function that withheld it, read by /refer. NULL = not withheld (and every existing row).
alter table public.referrals
  add column reward_withheld_reason text
  check (reward_withheld_reason is null or reward_withheld_reason in ('cap', 'referrer_deleted'));

comment on column public.referrals.reward_withheld_reason is
  '0215. Why this referral was activated but not paid in full: cap (the referrer was at 10 rewarded referrals in 30 days) or referrer_deleted. NULL = not withheld. Not backfilled.';

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_referrer_id uuid;
  v_referrer_email text;
  v_new_email_norm text;
  v_referrer_email_norm text;
  v_meta jsonb;
  v_full text;
  v_first text;
  v_last text;
begin
  v_meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);

  if v_meta ->> 'referred_by_code' is not null then
    select id, email into v_referrer_id, v_referrer_email
    from public.profiles
    where referral_code = v_meta ->> 'referred_by_code';

    if v_referrer_id is not null and v_referrer_email is not null then
      v_new_email_norm := public.normalize_email_for_self_referral(new.email);
      v_referrer_email_norm := public.normalize_email_for_self_referral(v_referrer_email);

      if v_new_email_norm = v_referrer_email_norm then
        v_referrer_id := null;
      end if;
    end if;
  end if;

  v_full := coalesce(
    nullif(btrim(v_meta ->> 'full_name'), ''),
    nullif(btrim(v_meta ->> 'name'), '')
  );

  v_first := coalesce(
    nullif(btrim(v_meta ->> 'first_name'), ''),
    nullif(btrim(v_meta ->> 'given_name'), ''),
    nullif(split_part(coalesce(v_full, ''), ' ', 1), '')
  );

  v_last := coalesce(
    nullif(btrim(v_meta ->> 'last_name'), ''),
    nullif(btrim(v_meta ->> 'family_name'), ''),
    case
      when v_full is not null and position(' ' in v_full) > 0
        then nullif(btrim(substr(v_full, position(' ' in v_full) + 1)), '')
      else null
    end
  );

  insert into public.profiles (id, first_name, last_name, email, country, referral_code, referred_by)
  values (
    new.id, v_first, v_last, new.email,
    v_meta ->> 'country', public.generate_referral_code(), v_referrer_id
  );

  -- 0215: the referral is RECORDED at signup and pays nothing; check_and_activate_referral pays the whole reward at activation.
  if v_referrer_id is not null then
    insert into public.referrals (referrer_id, referred_user_id, status, signed_up_at)
    values (v_referrer_id, new.id, 'signed_up', now());
  end if;

  return new;
end;
$function$;

create or replace function public.grant_referral_reward(p_referral_id uuid, p_referrer_id uuid, p_amount integer, p_reason credit_reason)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_referred_user_id uuid;
begin
  if public.count_rewarded_referrals_last_30d(p_referrer_id, p_referral_id) >= 10 then
    -- 0215: still pays nothing, but now says why on the referral itself.
    update public.referrals set reward_withheld_reason = 'cap' where id = p_referral_id;
    return;
  end if;

  perform public.grant_credits_atomic(p_referrer_id, p_amount, p_reason, p_referral_id);

  update public.referrals
  set reward_credits_referrer = reward_credits_referrer + p_amount
  where id = p_referral_id
  returning referred_user_id into v_referred_user_id;

  insert into public.referral_reward_events (referral_id, referrer_id, referred_user_id, credits_granted, reason)
  values (p_referral_id, p_referrer_id, v_referred_user_id, p_amount, p_reason);
end;
$function$;

create or replace function public.check_and_activate_referral(p_user_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_referral_id uuid;
  v_referrer_id uuid;
  v_activated boolean;
  v_paid integer;
  v_remainder integer;
begin
  select id, referrer_id into v_referral_id, v_referrer_id
  from public.referrals
  where referred_user_id = p_user_id and status = 'signed_up'
  limit 1;

  if v_referral_id is null then
    return;
  end if;

  v_activated := exists (
    select 1 from public.resumes where user_id = p_user_id and is_base = true
  ) or exists (
    select 1 from public.applications where user_id = p_user_id and applied_at is not null
  );

  if not v_activated then
    return;
  end if;

  -- The claim and the grant run in their OWN subtransaction (the BEGIN ... EXCEPTION block below). If anything in it fails, that subtransaction rolls back,
  -- claim included, so the referral stays 'signed_up' and nothing is paid; a WARNING names the referral and the SQLSTATE; and this function RETURNS NORMALLY,
  -- so the friend's own resume save or application, which called it from a trigger, still succeeds. Both triggers call this function again on the friend's
  -- next base-resume save or application, which is the retry.
  begin
    -- The claim: only the caller that moves signed_up -> activated goes on to pay.
    update public.referrals
    set status = 'activated', activated_at = now()
    where id = v_referral_id and status = 'signed_up'
    returning reward_credits_referrer into v_paid;

    if not found then
      return;
    end if;

    -- 0215: the referrer's account was deleted (0209 set referrer_id null). Nobody to pay and nobody to tell; this used to RAISE inside the
    -- friend's own trigger and fail their save/apply. Claimed, recorded, not paid.
    if v_referrer_id is null then
      update public.referrals set reward_withheld_reason = 'referrer_deleted' where id = v_referral_id;
      return;
    end if;

    -- The whole reward (50) less what this referral has already been paid (the signup half, for a referral made before 0215).
    v_remainder := 50 - coalesce(v_paid, 0);
    if v_remainder > 0 then
      perform public.grant_referral_reward(v_referral_id, v_referrer_id, v_remainder, 'referral_activation_bonus');
    end if;
  exception when others then
    raise warning 'check_and_activate_referral: referral % was not paid and stays signed_up for a retry (SQLSTATE %)', v_referral_id, sqlstate;
    return;
  end;
end;
$function$;

-- Self-checks: the live definitions are the ones intended, and the hardening 0211 applied is intact. A migration that "applied" the wrong text would
-- otherwise only show up as money, or as a quietly re-opened function.
do $$
declare
  v_signup text := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  v_activate text := pg_get_functiondef('public.check_and_activate_referral(uuid)'::regprocedure);
  v_grant text := pg_get_functiondef('public.grant_referral_reward(uuid, uuid, integer, credit_reason)'::regprocedure);
  r record;
begin
  if position('referral_signup_bonus' in v_signup) > 0 or position('grant_referral_reward' in v_signup) > 0 then
    raise exception 'self-check: handle_new_user still grants a signup reward';
  end if;
  if position('50 - coalesce' in v_activate) = 0 then
    raise exception 'self-check: check_and_activate_referral does not pay the remainder up to 50';
  end if;
  if position('where id = v_referral_id and status = ''signed_up''' in v_activate) = 0 then
    raise exception 'self-check: check_and_activate_referral does not claim the activation atomically';
  end if;
  if position('exception when others' in v_activate) = 0 or position('raise warning' in v_activate) = 0 then
    raise exception 'self-check: check_and_activate_referral does not isolate a payout failure from the friend''s own action';
  end if;
  if position('reward_withheld_reason = ''cap''' in v_grant) = 0 then
    raise exception 'self-check: grant_referral_reward does not record the cap';
  end if;
  -- EXECUTE grants (proacl), config (proconfig) and security mode are exactly what they were when this migration started: nothing granted, nothing unpinned.
  if jsonb_array_length(current_setting('migration.m0215_before')::jsonb) <> 3 then
    raise exception 'self-check: the before-state of the three functions was not captured';
  end if;
  for r in
    select b->>'fn' as fn, b->>'acl' as acl, b->>'config' as config, (b->>'secdef')::boolean as secdef,
           p.proacl::text as acl_now, p.proconfig::text as config_now, p.prosecdef as secdef_now
    from jsonb_array_elements(current_setting('migration.m0215_before')::jsonb) b
    join pg_proc p on p.oid = (b->>'fn')::regprocedure
  loop
    if r.acl is distinct from r.acl_now then
      raise exception 'self-check: EXECUTE grants on % changed (% -> %)', r.fn, r.acl, r.acl_now;
    end if;
    if r.config is distinct from r.config_now or r.config_now is null or position('search_path=public' in r.config_now) = 0 then
      raise exception 'self-check: search_path pin on % changed or is missing (% -> %)', r.fn, r.config, r.config_now;
    end if;
    if not r.secdef_now or r.secdef is distinct from r.secdef_now then
      raise exception 'self-check: % is not SECURITY DEFINER as before', r.fn;
    end if;
  end loop;
end $$;
