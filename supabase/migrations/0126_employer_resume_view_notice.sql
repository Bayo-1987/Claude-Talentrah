-- 0126 — the other half of the consent decision on 0125's employer-applicant
-- view: applying is still treated as implicit consent (no gate, no opt-out —
-- see CLAUDE.md's "Resolved, don't re-litigate" entry for 0125/PR #329), but
-- as a partial counterweight the seeker's Job Tracker now shows when an
-- employer has actually opened their resume. Informational only — it never
-- gates or delays the employer's own access, and there is still no consent
-- gate to bypass.
--
-- Two scoped decisions, stated rather than assumed:
--   1. "Viewed" means the employer opened the RESUME, not merely that they
--      saw the applicant row in the list. An application with no resume
--      attached can never trigger this in v1 — the UI only links to the
--      resume-view page when resume_id is set (posted-job-row.tsx / the
--      applicants page) — so a manual/no-resume application simply never
--      shows "Viewed". Narrower than "opening the applicant row", on
--      purpose: the applicant list is a roster, the resume is the seeker's
--      actual private content, and it's specifically that content being
--      looked at that the consent question in 0125 was about.
--   2. First view only, one timestamp, never overwritten. Nothing here asks
--      for "last viewed" or a view history — that's a bigger feature nobody
--      asked for yet.

-- =============================================================================
-- 1. first_viewed_at — set once, on employer_applicant_status (0125)
-- =============================================================================
alter table public.employer_applicant_status
  add column first_viewed_at timestamp with time zone;

-- =============================================================================
-- 2. record_employer_resume_view — the employer side, called from the resume
--    view page itself
-- =============================================================================
-- Same membership-check shape as is_org_member_for_application (0125): derive
-- the owning org from the application id the caller already has (because
-- employer_view_resume just returned it to them), never trust a client-
-- supplied org id.
--
-- Written as INSERT ... SELECT ... WHERE <membership check>, not a plpgsql
-- IF/RETURN: a caller who isn't a member produces zero source rows, so the
-- INSERT (and its ON CONFLICT) is a true no-op — no error, no distinguishable
-- difference between "not a member" and "no such application", matching
-- employer_view_resume's own refuse-silently shape one function over.
--
-- The ON CONFLICT clause is what makes this "set once": on a second call for
-- the same application, first_viewed_at already has a non-null value, so
-- coalesce(existing, new) keeps the existing one — the row still gets a real
-- UPDATE (and the stamp_employer_applicant_status trigger still fires,
-- refreshing updated_at/updated_by the same way any other write to this table
-- does), but the view timestamp itself does not move.
create or replace function public.record_employer_resume_view(p_application_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.employer_applicant_status (application_id, first_viewed_at)
  select p_application_id, now()
  where public.is_org_member_for_application(p_application_id)
  on conflict (application_id) do update
    set first_viewed_at = coalesce(
      public.employer_applicant_status.first_viewed_at,
      excluded.first_viewed_at
    );
$$;

revoke all on function public.record_employer_resume_view(uuid) from public;
revoke all on function public.record_employer_resume_view(uuid) from anon;
grant execute on function public.record_employer_resume_view(uuid) to authenticated, service_role;

comment on function public.record_employer_resume_view(uuid) is
  'Stamps employer_applicant_status.first_viewed_at the first time an employer opens ONE application''s resume, gated on org membership exactly like is_org_member_for_application. A no-op (not an error) for a caller who is not a member of the owning organisation, and for any other application id.';

-- =============================================================================
-- 3. seeker_application_view_status — the seeker side, read-only
-- =============================================================================
-- Deliberately a SECURITY DEFINER function returning exactly two columns,
-- NOT a new "seeker can read their own row" SELECT policy on
-- employer_applicant_status. CLAUDE.md's own standing lesson is explicit that
-- RLS restricts rows, not columns — a row-level policy scoped to "the
-- seeker's own application" would still expose `status` and `updated_by`
-- (the employer's internal New/Reviewing/Shortlisted/.../updated_by review
-- pipeline) on that same row, which nobody asked to hand the seeker and is
-- exactly the kind of accidental widening that column-grants exist to catch.
--
-- Gated on `applications.user_id = auth.uid()` — the CALLER'S OWN ownership,
-- not an org-membership check — so this does not have 0125's
-- "policy-inherits-table-RLS" failure mode: the caller IS the row's owner
-- here, the same reason a seeker's own read of `applications` already works
-- without a definer function at all. SECURITY DEFINER is still needed only
-- because the function has to read `employer_applicant_status`, which has no
-- seeker-facing policy of its own (§2 above) and is not meant to gain one.
--
-- Takes an array so the Tracker page can resolve every visible application's
-- view-status in one round trip, not one RPC call per card.
create or replace function public.seeker_application_view_status(p_application_ids uuid[])
returns table (
  application_id uuid,
  first_viewed_at timestamp with time zone
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, s.first_viewed_at
  from public.applications a
  join public.employer_applicant_status s on s.application_id = a.id
  where a.id = any (p_application_ids)
    and a.user_id = (select auth.uid())
    and s.first_viewed_at is not null;
$$;

revoke all on function public.seeker_application_view_status(uuid[]) from public;
revoke all on function public.seeker_application_view_status(uuid[]) from anon;
grant execute on function public.seeker_application_view_status(uuid[]) to authenticated, service_role;

comment on function public.seeker_application_view_status(uuid[]) is
  'For the CALLING seeker''s own applications only (applications.user_id = auth.uid()): returns (application_id, first_viewed_at) for each one an employer has actually opened. Never returns employer_applicant_status.status or .updated_by — those stay employer-internal. Silently omits any application id the caller does not own, rather than erroring.';
