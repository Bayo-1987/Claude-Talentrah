-- RENUMBERED 0138 -> 0143 (sibling dispatch collision, same as 0141/0142's
-- own header) — pure filename rename, applied to both live projects under
-- the OLD name (`0138_talent_verification_review_detail_candidate_id`).
--
-- 0143 — fix: talent_verification_review_detail (0142) never returned the
-- candidate's user_id, so the reviewer-decision Server Action
-- (decideVerificationReviewAction, src/lib/talent-directory/reviewer-actions.ts)
-- had no way to pass p_user_id to resolve_talent_verification without a
-- second, RLS-blocked read of talent_verifications it can't actually make
-- (the owner-only SELECT policy on that table means a reviewer's own session
-- can't read tv.user_id directly — the whole reason this is a SECURITY
-- DEFINER function in the first place). Caught before this ever shipped to
-- a real reviewer, while wiring up the Server Action in the same PR as 0142.
--
-- `CREATE OR REPLACE FUNCTION` cannot add a column to an existing
-- `RETURNS TABLE (...)` — that changes the function's return type, which
-- Postgres refuses ("cannot change return type of existing function") —
-- so this drops and recreates it, same as any other output-shape fix to a
-- table-returning function. It has no callers yet outside this same PR's own
-- code, so there is nothing depending on the old (buggy) shape.

drop function if exists public.talent_verification_review_detail(uuid);

create or replace function public.talent_verification_review_detail(p_verification_id uuid)
returns table (
  id uuid,
  status text,
  target_role text,
  target_industry text,
  requested_at timestamptz,
  candidate_id uuid,
  candidate_first_name text,
  candidate_last_name text,
  resume jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return query
    select tv.id, tv.status, tv.target_role, tv.target_industry, tv.requested_at,
           tv.user_id, p.first_name, p.last_name,
           coalesce(r.structured_content, '{}'::jsonb)
    from public.talent_verifications tv
    join public.profiles p on p.id = tv.user_id
    left join public.resumes r on r.user_id = tv.user_id and r.is_base = true
    where tv.id = p_verification_id
      and tv.reviewer_id = auth.uid()
      and tv.status = 'claimed';
end;
$$;

revoke all on function public.talent_verification_review_detail(uuid) from public, anon;
grant execute on function public.talent_verification_review_detail(uuid) to authenticated;
