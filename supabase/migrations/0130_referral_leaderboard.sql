-- 0130 — the referral leaderboard (send-140, build-prompt §6.7's own
-- "[DECIDE — optional, adds gamification]" item).
--
-- ── WHY THIS IS OPT-IN, NOT AUTOMATIC ──────────────────────────────────────
--
-- A leaderboard is the first surface in this product where one user's
-- activity becomes visible to OTHER users by default. Every existing surface
-- — Job Tracker, applications, credits balance — is private to its owner.
-- Defaulting everyone onto a public ranking the moment they refer someone is
-- a bigger exposure change than anything shipped so far, so it needs its own
-- explicit consent rather than inheriting "referred someone" as implicit
-- opt-in. `referral_leaderboard_opt_in` defaults FALSE.
--
-- ── WHY TWO NEW `profiles` COLUMNS, NOT A SEPARATE TABLE ───────────────────
--
-- Both are user-owned, carry no money and no trust, and change nothing about
-- anyone but the person writing them — the same category `locale` and
-- `farah_hint_dismissed` already sit in (see 0066's own header for that exact
-- reasoning). A display name independent of the profile's real name is new
-- in KIND (the first place a user picks a public-facing identity) but not in
-- RISK: it is still just copy this same person chose to show, on their own
-- row, gated by the SAME opt-in that decides whether it's shown at all.
--
-- ── WHY THE RANKING METRIC IS `activated_at`, NOT `signed_up_at` OR A RAW
--    INVITE COUNT ──────────────────────────────────────────────────────────
--
-- "Invited" is trivially inflatable (send a link to everyone in your
-- contacts) and pays nothing. `activated_at` is the exact column
-- `check_and_activate_referral`/`grant_referral_reward` already use to decide
-- what actually earns a reward — reusing it directly means the leaderboard
-- can never drift from what the reward system itself pays out on, and it
-- INHERITS 0036's self-referral protection for free: a self-referral never
-- reaches `status = 'activated'` in the first place (handle_new_user's own
-- email-normalisation check keeps it from ever qualifying), so counting
-- `activated_at` rows adds no redundant check and cannot be bypassed by
-- anything this migration does.
--
-- ── WHY A SECURITY DEFINER FUNCTION, NOT A WIDENED RLS POLICY ──────────────
--
-- An employer querying across other users' data (send-139's Talent
-- Directory) and a seeker querying across other SEEKERS' referral counts
-- here are the same shape of new risk: nothing in this app currently lets
-- one user's own client read data belonging to a different user's row.
-- `profiles` and `referrals` are both self-scoped by RLS (0000's own
-- "profiles are self-readable" / "referrals are readable by either party"
-- policies) — widening either policy to admit a leaderboard read would widen
-- it for every OTHER caller of that policy too, the same "a widened policy
-- widens every function that inherits it" lesson CLAUDE.md already states
-- for 0107/0108. A narrow, single-purpose SECURITY DEFINER function is the
-- same choice `employer_job_applicants` and `record_employer_resume_view`
-- already made for their own "read across users, but only exactly this
-- much" cases: it returns ONLY a rank, a display name, and a count — never
-- an id, an email, or anything belonging to an opted-out user, because its
-- own WHERE clause is the only thing standing between "public leaderboard"
-- and "every seeker's referral history".

alter table public.profiles
  add column referral_leaderboard_opt_in boolean not null default false,
  add column referral_leaderboard_display_name text;

comment on column public.profiles.referral_leaderboard_opt_in is
  'Whether this user has opted into appearing on the referral leaderboard (send-140). Defaults false — a public ranking is a bigger exposure change than anything else in this app, so it is never automatic.';

comment on column public.profiles.referral_leaderboard_display_name is
  'Optional handle shown on the referral leaderboard INSTEAD OF first_name, independent of the user''s real profile name. Null falls back to first_name at query time (referral_leaderboard()); an empty string is treated the same as null.';

-- 0030's own lesson, applied again: profiles' table-level UPDATE grant to
-- authenticated is already revoked, replaced by an explicit column list.
-- These two are exactly the "user gains something real, nobody else's data
-- moves" category that list already exists to admit.
grant update (referral_leaderboard_opt_in, referral_leaderboard_display_name) on public.profiles to authenticated;

create or replace function public.referral_leaderboard(
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_limit integer default 20
)
returns table (rank integer, display_name text, activated_count integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    (row_number() over (order by count(*) desc, min(r.activated_at) asc))::int as rank,
    coalesce(nullif(trim(p.referral_leaderboard_display_name), ''), p.first_name, 'A Talentrah member') as display_name,
    count(*)::int as activated_count
  from public.referrals r
  join public.profiles p on p.id = r.referrer_id
  where r.status = 'activated'
    and r.activated_at >= p_period_start
    and r.activated_at < p_period_end
    and p.referral_leaderboard_opt_in = true
  group by p.id, p.referral_leaderboard_display_name, p.first_name
  order by count(*) desc, min(r.activated_at) asc
  limit p_limit;
$$;

-- `authenticated` only, not `anon` — the leaderboard lives at /refer, which
-- already requires a session (requireUser()). Nothing about the function
-- itself needs signed-out reach, and granting it would just be surface this
-- product does not need.
revoke all on function public.referral_leaderboard(timestamptz, timestamptz, integer) from public;
grant execute on function public.referral_leaderboard(timestamptz, timestamptz, integer) to authenticated;

comment on function public.referral_leaderboard(timestamptz, timestamptz, integer) is
  'Ranked activated-referral counts for OPTED-IN users only, within one period. SECURITY DEFINER because profiles/referrals are both self-scoped by RLS — this is the one narrow, deliberate cross-user read, and its own WHERE clause (not a table policy) is what keeps an opted-out user''s data from ever reaching it.';
