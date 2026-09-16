-- Every mentor's real name was invisible to every non-owner viewer.
--
-- src/lib/mentorship/queries.ts's browseMentors() and getMentorProfile() both
-- fetch a mentor's display name via an embedded join through the
-- AUTHENTICATED client: profiles!mentor_profiles_user_id_fkey(first_name,
-- last_name). That file's own header comment claims every read in it is
-- "exactly what 0133's RLS policies already allow a signed-in user to see
-- (approved mentors publicly...)" — true for mentor_profiles itself (0132/
-- 0161 already give it a public-when-approved SELECT policy), false for the
-- profiles join. `profiles` carries only two policies, both self-scoped:
--
--   "profiles are self-readable" (SELECT, auth.uid() = id)
--   "profiles are self-updatable" (UPDATE, auth.uid() = id)
--
-- So the embedded join silently returns null for any viewer who isn't the
-- row owner — not an error, just no row — and both call sites' `name ||
-- "A Talentrah mentor"` fallback fires every time. Confirmed live: viewing
-- /mentorship/f977d1ea-c4e9-4bab-91fa-1c4661f787a3 (the one seeded, approved
-- mentor, real name "Zimcrest Technologies" in profiles) as a different
-- account showed the fallback string; viewing it as the mentor's own account
-- showed the real name. Same row, two answers, depending only on who asks —
-- every mentor, to every viewer who isn't them, on both /mentorship and
-- /mentorship/[mentorId].
--
-- THE FIX FOLLOWS THIS CODEBASE'S OWN ESTABLISHED PATTERN FOR THE IDENTICAL
-- SHAPE OF PROBLEM: talent_directory_portfolio_items() (0135) already reads
-- one user's data on another user's behalf without widening that table's own
-- RLS — "an employer reads another user's items only through
-- talent_directory_portfolio_items(), never through a widened SELECT policy
-- on this table" (0135's own comment on talent_portfolio_items). Copied here
-- rather than widening "profiles are self-readable" or adding a second,
-- broader SELECT policy — CLAUDE.md's own 0030 finding is exactly about
-- `profiles` being the table that must never get a broader grant than it
-- needs, because RLS row policies don't restrict columns: a wider SELECT
-- policy plus the existing self-write policy is a bigger surface than it
-- looks.
--
-- Batched, not scalar — browseMentors() fetches a list and would otherwise
-- N+1; getMentorProfile() calls the same function with a single-element
-- array. The eligibility gate is simpler than talent_directory_portfolio_
-- items()'s: no caller-side entitlement check is needed (any authenticated
-- user may see any approved mentor's name — that is the entire point of
-- being a public mentor), only a per-row target check that the requested id
-- actually has an approved mentor_profiles row. Narrow like its model: this
-- returns only (user_id, first_name, last_name), never any other profiles
-- column.
create or replace function public.mentor_public_names(p_mentor_ids uuid[])
returns table (user_id uuid, first_name text, last_name text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return query
    select p.id, p.first_name, p.last_name
    from public.profiles p
    where p.id = any(p_mentor_ids)
      and exists (
        select 1 from public.mentor_profiles mp
        where mp.user_id = p.id
          and mp.status = 'approved'
      );
end;
$$;

revoke all on function public.mentor_public_names(uuid[]) from public, anon;
grant execute on function public.mentor_public_names(uuid[]) to authenticated;
