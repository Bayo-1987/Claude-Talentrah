-- 0092 — Re-price the referral rewards the 0089 rebase missed.
--
-- 0089 moved CREDIT_COSTS.tailoringRun 5 -> 20 and rebased every credit pack
-- and action price alongside it. It could not touch these two amounts
-- because they are not read from CREDIT_COSTS at all: grant_referral_reward
-- is called from inside two Postgres TRIGGERS (handle_new_user, on
-- auth.users insert; check_and_activate_referral, on a referred user's
-- resumes/applications changing) with no TypeScript call site in between —
-- unlike every other credit-affecting function (spend_credits_atomic,
-- auto_apply_claim_submission, debit_ad_wallet/credit_ad_wallet), which all
-- take the amount as a parameter that the calling application code supplies
-- from CREDIT_COSTS at the moment of the call. A referral's reward is
-- decided entirely inside Postgres, so nothing connected it to the rebase.
--
-- Before this: a referral was worth 5 tailoring runs (25 credits / 5 =
-- tailoringRun-then). After 0089, unfixed, it would have been worth 1.25 —
-- and the 5-credit signup bonus on its own could not buy a CV tailoring at
-- all (it bought two bullet rewrites and nothing else).
--
-- Founder-ratified values (src/lib/referrals/rewards.ts has the full
-- reasoning for each):
--   signup bonus:      5  -> 10   (REFERRAL_SIGNUP_BONUS_CREDITS — flat,
--                                  deliberately NOT denominated in an
--                                  action; a bare signup is the gameable
--                                  step)
--   activation bonus: 20  -> 40   (REFERRAL_ACTIVATION_BONUS_CREDITS =
--                                  2 * CREDIT_COSTS.tailoringRun — two CV
--                                  tailorings, the real prize, reads as one)
--
-- Both functions are rewritten in full rather than patched, matching 0036's
-- own convention for the same functions — only the literal amount passed to
-- grant_referral_reward changes in each; every other line is byte-identical
-- to the currently-live definition (confirmed against production via
-- pg_get_functiondef before writing this migration).
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

  update public.referrals set status = 'activated', activated_at = now() where id = v_referral_id;
  perform public.grant_referral_reward(v_referral_id, v_referrer_id, 40, 'referral_activation_bonus');
end;
$function$
;

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
  v_referral_id uuid;
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

  if v_referrer_id is not null then
    insert into public.referrals (referrer_id, referred_user_id, status, signed_up_at)
    values (v_referrer_id, new.id, 'signed_up', now())
    returning id into v_referral_id;

    perform public.grant_referral_reward(v_referral_id, v_referrer_id, 10, 'referral_signup_bonus');
  end if;

  return new;
end;
$function$
;
