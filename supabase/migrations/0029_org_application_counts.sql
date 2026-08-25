-- 0029 — Let an employer see how many people applied, without letting them
-- see who.
--
-- The Jobs Posted view needs an application count per posting. It cannot get
-- one by querying `applications`: that table is owner-only
-- (`auth.uid() = user_id`), correctly — an employer has no business reading a
-- seeker's application rows, and the cross-user RLS suite asserts exactly that.
-- A plain count from the client returns 0 for every posting, which would have
-- been a silently wrong number rather than an error.
--
-- So: a SECURITY DEFINER function that reads past RLS and returns *only*
-- aggregate counts. No user_id, no resume, no notes, no stage detail — nothing
-- that identifies an applicant. The one thing a caller learns is a number for
-- a job belonging to an organisation they are already a member of.
--
-- The membership check is inside the function and non-negotiable: a definer
-- function is exactly the shape the service-role audit (PR #18) flagged as
-- dangerous when it trusts a caller-supplied id, so this one derives nothing
-- from its argument except which org to look at, and refuses if the caller
-- is not in it. Callers cannot pass someone else's org id and learn anything.
--
-- Follows 0016/0017's convention for definer functions: pinned search_path,
-- EXECUTE revoked from the world and granted deliberately. `authenticated`
-- only — anon has no organisation to be a member of.

create or replace function public.org_application_counts(p_organization_id uuid)
returns table (job_posting_id uuid, application_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select a.job_posting_id, count(*)::bigint
  from public.applications a
  join public.job_postings j on j.id = a.job_posting_id
  where j.organization_id = p_organization_id
    and j.source_type = 'internal'
    -- The gate. Without this, any signed-in user could count applications for
    -- any organisation by guessing its id.
    and public.is_org_member(p_organization_id)
  group by a.job_posting_id;
$$;

revoke all on function public.org_application_counts(uuid) from public;
revoke all on function public.org_application_counts(uuid) from anon;
grant execute on function public.org_application_counts(uuid) to authenticated, service_role;
