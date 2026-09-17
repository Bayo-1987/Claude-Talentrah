-- Same shape of bug as 0167, found while investigating that one: a mentee
-- viewing their own booked sessions (/mentorship/sessions) sees the generic
-- "Mentor" fallback instead of the mentor's real name, and a mentor viewing
-- their own sessions (/mentorship/sessions/mentor) sees "Mentee" instead of
-- the mentee's real name. Confirmed live before writing anything: a real
-- mentee + mentor + booked mentorship_sessions row, viewed as each party in
-- turn, showed the generic fallback on both sides.
--
-- Root cause is loadSessions() (src/lib/mentorship/queries.ts), which reads
-- BOTH parties' names in one query — `.from("profiles").select("id,
-- first_name, last_name").in("id", profileIds)` — through the authenticated
-- client. `profiles` carries only the same two self-scoped RLS policies
-- 0167's own migration already documented (SELECT/UPDATE, both
-- `auth.uid() = id`), so this `.in()` lookup only ever returns the CALLER's
-- own row; the other party's row is filtered out by RLS every time,
-- regardless of which side of the session they're on.
--
-- THIS IS NOT THE SAME GATE AS 0167. mentor_public_names() correctly makes
-- an approved mentor's name public to ANY authenticated user — that is the
-- entire point of being a discoverable, bookable mentor. A session's
-- COUNTERPARTY is not public in that sense: nothing here should let a
-- caller learn an arbitrary user's name just by knowing their id, only the
-- name of someone they actually share a real mentorship_sessions row with.
-- So the eligibility check below is scoped to auth.uid() (the caller),
-- never a client-supplied id — the same "never a client-supplied
-- organization id" reasoning 0135 already states for
-- talent_directory_search/talent_directory_portfolio_items, applied to the
-- shape this table actually has: a two-sided relationship, not a
-- one-sided public listing.
create or replace function public.mentorship_session_counterparty_names(p_user_ids uuid[])
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
