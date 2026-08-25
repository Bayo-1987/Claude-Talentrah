-- 0036 — Close the dotted-alias self-referral farming vector.
--
-- ---------------------------------------------------------------------------
-- The hole
-- ---------------------------------------------------------------------------
-- `handle_new_user` normalised a signup email for self-referral detection with
-- lowercase + `+suffix` stripping and nothing else. Gmail also ignores DOTS in
-- the local part, so `j.doe@gmail.com` and `jdoe@gmail.com` are one inbox and
-- normalised to two different strings.
--
-- Measured against the live project before the fix, with a real signup pair:
--
--   dotted alias (j.doe vs jdoe)   referral_row=CREATED  signup_bonus=*** PAID ***  balance=5
--   +suffix alias                  referral_row=none     signup_bonus=blocked       balance=0
--
-- So: sign up once, take your referral link, sign up again with a dot moved,
-- and collect both sides of the reward from a single inbox. Repeatable up to
-- the 10-per-30-days cap — 50 credits a month per code, with no activation
-- required for the signup half.
--
-- ---------------------------------------------------------------------------
-- Why dot-stripping is scoped to Gmail rather than applied to every domain
-- ---------------------------------------------------------------------------
-- Because dots are only insignificant at providers that say they are. At a
-- corporate domain, `j.doe@acme.com` and `jdoe@acme.com` are routinely two
-- different people — Jane Doe and John Doe. Stripping dots there would block a
-- genuine referral between two colleagues and silently deny both of them a
-- reward, which is a worse failure than the one being fixed: the farming vector
-- costs credits, a false positive costs a real user their payout and gives them
-- no explanation.
--
-- Covered: gmail.com and googlemail.com (the same inbox, so googlemail folds
-- into gmail).
-- NOT covered, deliberately: every other provider. Outlook/Hotmail, Yahoo,
-- Proton and iCloud all treat dots as significant, so there is nothing to
-- strip. Providers with other aliasing schemes (iCloud's hide-my-email,
-- Outlook's aliases, catch-all domains) are not detectable from the address at
-- all and remain out of reach of any email-shape heuristic — the 10-per-30-days
-- cap is what bounds those, not this function.
--
-- Case variants need no handling here beyond the existing lower(): Supabase
-- Auth rejects a second account differing only in case with `email_exists`, so
-- the pair cannot be created in the first place. The lower() call stays as
-- belt-and-braces rather than the primary defence.
--
-- Extracted into its own function rather than inlined: it is the one piece of
-- this trigger with real rules in it, and having it callable makes it directly
-- testable instead of only observable through a signup.

create or replace function public.normalize_email_for_self_referral(p_email text)
returns text
language sql
immutable
set search_path = public
as $$
  with parts as (
    select
      regexp_replace(lower(split_part(p_email, '@', 1)), '\+.*$', '') as local_part,
      lower(split_part(p_email, '@', 2)) as domain
  )
  select
    case
      when domain in ('gmail.com', 'googlemail.com') then replace(local_part, '.', '')
      else local_part
    end
    || '@' ||
    case when domain = 'googlemail.com' then 'gmail.com' else domain end
  from parts;
$$;

-- Nothing client-side calls this; it exists for handle_new_user (SECURITY
-- DEFINER, runs as owner) and for the test suite via the service role. Same
-- reasoning as 0032's generate_referral_code revoke.
revoke all on function public.normalize_email_for_self_referral(text) from public;
revoke all on function public.normalize_email_for_self_referral(text) from anon;
revoke all on function public.normalize_email_for_self_referral(text) from authenticated;
grant execute on function public.normalize_email_for_self_referral(text) to postgres, service_role;

-- Rewritten in full rather than patched: the name-precedence block below is
-- load-bearing (migration 0024 — Google sends no given_name) and must survive
-- verbatim. Only the two normalisation lines change.
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

    perform public.grant_referral_reward(v_referral_id, v_referrer_id, 5, 'referral_signup_bonus');
  end if;

  return new;
end;
$function$;
