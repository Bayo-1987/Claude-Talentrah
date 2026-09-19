-- send-418 — a real, mentor-settable display name, separate from whatever
-- was typed into `profiles.first_name`/`last_name` at ordinary account
-- signup.
--
-- send-400 (0501/PR #501, already merged) diagnosed why both of production's
-- only two mentor accounts ("Zimcrest Technologies", "Info Talentrah") show
-- an organisation-looking name: `mentor_public_names()` (0167) and
-- `mentorship_session_counterparty_names()` (0168) both read a mentor's
-- public name straight off `profiles.first_name`/`last_name` — the field
-- filled in at ordinary signup, which for these two accounts is literally
-- the company/account name someone typed there. There is no separate,
-- correct "real name" sitting elsewhere in the data a rename could recover
-- (founder-confirmed) — the actual fix is a new field a mentor sets
-- themselves, decoupled from the signup name entirely.
--
-- NULLABLE, and deliberately not backfilled for either existing mentor row:
-- there is no correct value to guess into it (the founder's own point above
-- — inventing one here would be exactly the "hardcode a guess" the task
-- explicitly rules out), so both existing rows keep falling back to
-- first_name/last_name until whoever controls that account sets this
-- themselves through /mentorship/apply.
alter table public.mentor_profiles add column display_name text;

-- Same column-grant discipline 0133 already established for this table
-- (0030's lesson: RLS row policies don't restrict columns, only a grant
-- does) — ADDITIVE, matching how 0142 (reviews_verifications) and 0174
-- (self_paused) each layered their own column onto 0133's original grant
-- WITHOUT a `revoke update ... from authenticated` first. A revoke-then-
-- grant here would wipe every column those two migrations already added —
-- caught by this migration's own dry run against dozaffzgqkbarxtlclsj,
-- where it broke tests/rls/mentorship.test.ts's and
-- tests/mentorship/admin-suspend-reinstate.test.ts's self_paused checks.
grant update (display_name) on public.mentor_profiles to authenticated;

-- Return shape is changing (a new display_name column), which `create or
-- replace function` cannot do for an existing function — drop first, same
-- as any other migration in this repo that widens a function's result set.
drop function if exists public.mentor_public_names(uuid[]);

create function public.mentor_public_names(p_mentor_ids uuid[])
returns table (user_id uuid, first_name text, last_name text, display_name text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return query
    select p.id, p.first_name, p.last_name, mp.display_name
    from public.profiles p
    join public.mentor_profiles mp on mp.user_id = p.id
    where p.id = any(p_mentor_ids)
      and mp.status = 'approved'
      and not mp.self_paused;
end;
$$;

revoke all on function public.mentor_public_names(uuid[]) from public, anon;
grant execute on function public.mentor_public_names(uuid[]) to authenticated;

drop function if exists public.mentorship_session_counterparty_names(uuid[]);

-- Left join, not the inner join above: a session counterparty is not always
-- an approved mentor (a mentee counterparty never has a mentor_profiles row
-- at all), so display_name is simply null for anyone without one — the
-- caller-side fallback to first_name/last_name is unaffected either way.
create function public.mentorship_session_counterparty_names(p_user_ids uuid[])
returns table (user_id uuid, first_name text, last_name text, display_name text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return query
    select p.id, p.first_name, p.last_name, mp.display_name
    from public.profiles p
    left join public.mentor_profiles mp on mp.user_id = p.id and mp.status = 'approved'
    where p.id = any(p_user_ids)
      and exists (
        select 1 from public.mentorship_sessions s
        where (s.mentor_id = auth.uid() and s.mentee_id = p.id)
           or (s.mentee_id = auth.uid() and s.mentor_id = p.id)
      );
end;
$$;

revoke all on function public.mentorship_session_counterparty_names(uuid[]) from public, anon;
grant execute on function public.mentorship_session_counterparty_names(uuid[]) to authenticated;
