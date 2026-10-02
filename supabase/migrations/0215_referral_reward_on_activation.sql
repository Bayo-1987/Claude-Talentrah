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
-- The cap itself (10 rewarded referrals per referrer in a rolling 30 days, grant_referral_reward) is untouched, as is self-referral
-- detection (0036) in handle_new_user.
--
-- A referral that activates while its referrer is at the cap is still marked activated and still paid nothing (grant_referral_reward
-- returns silently). That is now VISIBLE rather than silent: /refer derives "withheld by the limit" from an activated referral whose
-- reward_credits_referrer is below the full reward, so no new column is needed.
--
-- ONE SMALL HARDENING, in the same function: the activation used to be "select ... where status = 'signed_up'" then, later,
-- "update ... set status = 'activated'", with the grant after it. Two concurrent calls could both pass the select and both pay. The
-- update is now the claim itself (`where status = 'signed_up'`, and the function stops if it claimed nothing), so exactly one caller moves
-- a referral to activated and only that caller pays. (CLAUDE.md: anything that gates on a compared value must check and act in one statement.)
--
-- THE 50 IS A LITERAL, as the 10 and 40 were: Postgres cannot import a TypeScript constant. src/lib/referrals/rewards.ts
-- (REFERRAL_REWARD_CREDITS) is the other half, and tests/referrals/referrals.test.ts reads the amount the live trigger really grants and
-- compares it, so a future repricing that forgets one side fails there.
--
-- Both functions are rewritten in full (0036/0092's convention). Everything not named above is byte-identical to the definition live on
-- production (confirmed with pg_get_functiondef before writing this): handle_new_user keeps the referrer lookup, the self-referral
-- check, the name handling and the profile insert, and loses only the signup grant.

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

  -- The claim: only the caller that moves signed_up -> activated goes on to pay.
  update public.referrals
  set status = 'activated', activated_at = now()
  where id = v_referral_id and status = 'signed_up'
  returning reward_credits_referrer into v_paid;

  if not found then
    return;
  end if;

  -- The whole reward (50) less what this referral has already been paid (the signup half, for a referral made before 0215).
  v_remainder := 50 - coalesce(v_paid, 0);
  if v_remainder > 0 then
    perform public.grant_referral_reward(v_referral_id, v_referrer_id, v_remainder, 'referral_activation_bonus');
  end if;
end;
$function$;

-- Self-checks: the live definitions are the ones intended. A migration that "applied" the wrong text would otherwise only show up as money.
do $$
declare
  v_signup text := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  v_activate text := pg_get_functiondef('public.check_and_activate_referral(uuid)'::regprocedure);
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
  if not exists (select 1 from pg_proc where oid = 'public.handle_new_user()'::regprocedure and prosecdef) then
    raise exception 'self-check: handle_new_user lost SECURITY DEFINER';
  end if;
end $$;
