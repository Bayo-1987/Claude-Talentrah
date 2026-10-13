-- 0259 (number assigned by the CTO, 10 Oct): "N new" applicants per job for an employer's own organisation (NEW-APPLICANT NOTIFICATIONS, owner spec 10 Oct 2026: an "N new" badge on Jobs Posted and the applicants list).
--
-- WHY A FUNCTION. `applications` is owner-only under RLS, so an employer reading it directly gets zero rows (the same reason org_application_counts, 0029, exists). "New" is the employer's own review state: an applicant is NEW
-- until the employer sets any status other than 'new' on them (employer_applicant_status, 0125: no row at all also reads as 'new'). Opening a resume does NOT make someone not-new: the status is the one signal the
-- employer controls, and it is the same one the applicants page already shows and filters on.
--
-- WHAT IS EXPOSED. A count per posting of the caller's own organisation, nothing about any person. SECURITY DEFINER with an empty search_path (every name inside is schema-qualified), and the caller must be a member of
-- the organisation (public.is_org_member, evaluated on the argument): another organisation's id returns no rows. Internal postings only, and only applications that were actually submitted (applied_at is not null), the
-- same predicates org_application_counts and employer_job_applicants use.
--
-- GRANTS. EXECUTE for authenticated (the employer's own session, as org_application_counts) and service_role; revoked from public and anon.
--
-- PER-REQUEST COST. Server work per request: one extra grouped count over the organisation's applications on the Jobs Posted page (the same index path org_application_counts already walks). None elsewhere.
--
-- ADDITIVE for the running app: a new function nothing deployed calls. Applied BEFORE the code that uses it merges. The exact undo is supabase/rollbacks/0259_employer_new_applicant_counts.rollback.sql.

create or replace function public.employer_new_applicant_counts(p_organization_id uuid)
returns table (job_posting_id uuid, new_count integer)
language sql
stable
security definer
set search_path = ''
as $f$
  select a.job_posting_id, (count(*))::integer
    from public.applications a
    join public.job_postings j on j.id = a.job_posting_id
    left join public.employer_applicant_status s on s.application_id = a.id
   where j.organization_id = p_organization_id
     and j.source_type = 'internal'::public.job_source_type
     and public.is_org_member(p_organization_id)
     and a.applied_at is not null
     and coalesce(s.status, 'new'::public.applicant_review_status) = 'new'::public.applicant_review_status
   group by a.job_posting_id;
$f$;

revoke all on function public.employer_new_applicant_counts(uuid) from public, anon;
grant execute on function public.employer_new_applicant_counts(uuid) to authenticated, service_role;

comment on function public.employer_new_applicant_counts(uuid) is
  '0259: per posting of the caller''s own organisation, how many submitted applications are still NEW (no employer status yet, or status new). Counts only; members of the organisation only. Internal postings only.';

-- Self-check: the function exists with the intended grants and actually runs (a random organisation id answers no rows, not an error).
do $check$
declare
  v_rows integer;
begin
  if has_function_privilege('anon', 'public.employer_new_applicant_counts(uuid)', 'execute') then
    raise exception '0259: anon can execute employer_new_applicant_counts';
  end if;
  if not has_function_privilege('authenticated', 'public.employer_new_applicant_counts(uuid)', 'execute') then
    raise exception '0259: authenticated cannot execute employer_new_applicant_counts';
  end if;
  select count(*) into v_rows from public.employer_new_applicant_counts(gen_random_uuid());
  if v_rows <> 0 then
    raise exception '0259: an unknown organisation returned rows';
  end if;
end
$check$;
