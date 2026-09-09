-- 0125 — The real employer-applicant view: a structured listing, a
-- shareable page, and applicants instead of a flooded inbox — the founder's
-- own call was to ship the feature that makes that claim true, not soften
-- the copy to "a real applicant count."
--
-- Confirmed directly against origin/main before writing this: there is no
-- employer-facing applicant list anywhere in the codebase today. 0029
-- (org_application_counts) and 0059 (internal_applicant_counts) both exist
-- specifically to answer "how many", never "who" — their own headers say so.
-- This is genuinely new surface area: an organisation gets identity-bearing
-- data about a seeker (name, resume content, application timing) for the
-- first time. Treated with the same weight as 0026–0030/0107–0109.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH. `applications.stage` — 0037's own
-- header calls that column the seeker's private Job Tracker field, full
-- stop. Nothing below reads it, writes it, or extends its enum. The
-- employer-facing status added here is new, separate storage, and the two
-- can never collide by construction (no trigger, no shared column).
--
-- STYLE NOTE: matches 0059's stricter `set search_path = ''` with every
-- reference schema-qualified, not 0029's bare-name `set search_path =
-- public` — that is the direction this codebase's own convention moved
-- between the two, and new code should follow the later one.

-- =============================================================================
-- 1. Employer-side applicant status — new storage, not applications.stage
-- =============================================================================
-- Six values, matching the founder's own mockup vocabulary.
create type public.applicant_review_status as enum (
  'new', 'reviewing', 'shortlisted', 'interviewing', 'hired', 'not_a_fit'
);

-- One row per application, created on first status change (see the trigger
-- and RLS below) — an application with no row yet reads as 'new' via
-- coalesce in employer_job_applicants (§2), so the UI never special-cases
-- "no row exists".
create table public.employer_applicant_status (
  application_id uuid primary key references public.applications(id) on delete cascade,
  status public.applicant_review_status not null default 'new',
  updated_at timestamp with time zone not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.employer_applicant_status enable row level security;

-- WHY A SECURITY DEFINER HELPER, NOT AN INLINE EXISTS CLAUSE — found by
-- sabotage-testing this exact policy, not assumed correct from reading it.
-- The first version of this migration inlined `exists (select 1 from
-- applications a join job_postings j ... where a.id = application_id and
-- is_org_member(j.organization_id))` directly in each USING/WITH CHECK
-- clause. That FAILED for the legitimate owning org in the RLS test suite —
-- a real 42501 on a write that should have succeeded — because a policy's
-- subquery runs as the CALLING role, and `applications` is owner-only RLS
-- (`auth.uid() = user_id`). An employer's session is not that row's owner,
-- so `applications` hides the row from the subquery just as it is designed
-- to for anyone querying it directly — the inline EXISTS was silently
-- querying through the exact wall it needed to see past. This is precisely
-- why `is_org_member` itself has to be SECURITY DEFINER (0026's own header):
-- a non-definer helper referencing an owner-only table inherits that table's
-- policy instead of bypassing it. Wrapping the whole check in its own
-- SECURITY DEFINER function, the same way, fixes it the same way.
create or replace function public.is_org_member_for_application(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.applications a
    join public.job_postings j on j.id = a.job_posting_id
    where a.id = p_application_id
      and public.is_org_member(j.organization_id)
  );
$$;

revoke all on function public.is_org_member_for_application(uuid) from public;
grant execute on function public.is_org_member_for_application(uuid) to authenticated, service_role;

-- RLS, not a SECURITY DEFINER function, for the TABLE's own read/write gate
-- — and that is a deliberate difference from §2/§3's functions below, not an
-- inconsistency. Unlike `applications`/`resumes`, this table is brand new
-- and was never owner-only: there is no existing policy on IT to defeat, so
-- there is nothing a definer function would buy for the table itself that
-- direct RLS does not already give for free — the definer function above
-- exists only because the MEMBERSHIP CHECK needs to reach past a boundary,
-- which is a different problem from the row-gate on this table.
--
-- Membership is derived ENTIRELY from `application_id` through the existing
-- FK chain (applications.job_posting_id -> job_postings.organization_id).
-- Nothing here trusts a client-supplied organisation id, and no such column
-- exists on this table to spoof — the one thing a caller controls is which
-- application_id to name, and the policy independently resolves whether that
-- application belongs to a job posting the caller's org owns.
create policy "org members can read their applicants' status"
  on public.employer_applicant_status
  for select
  to authenticated
  using (public.is_org_member_for_application(application_id));

create policy "org members can set their applicants' status"
  on public.employer_applicant_status
  for insert
  to authenticated
  with check (public.is_org_member_for_application(application_id));

create policy "org members can update their applicants' status"
  on public.employer_applicant_status
  for update
  to authenticated
  using (public.is_org_member_for_application(application_id))
  with check (public.is_org_member_for_application(application_id));

-- `updated_at`/`updated_by` are stamped here rather than trusted from the
-- client, the same reasoning `closed_at`/`removed_at` get a service-role-only
-- write elsewhere in this schema: RLS restricts ROWS, not columns (CLAUDE.md),
-- so without this a caller's own UPDATE could claim any updated_by it liked.
-- Cheaper than a column-level grant/revoke pair here, because the trigger
-- overwrites the value outright rather than merely permitting or refusing it.
create or replace function public.stamp_employer_applicant_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

revoke all on function public.stamp_employer_applicant_status() from public;
grant execute on function public.stamp_employer_applicant_status() to authenticated, service_role;

drop trigger if exists employer_applicant_status_stamp on public.employer_applicant_status;
create trigger employer_applicant_status_stamp
  before insert or update on public.employer_applicant_status
  for each row
  execute function public.stamp_employer_applicant_status();

-- =============================================================================
-- 2. Per-job applicant list — identity-bearing, unlike 0029/0059's counts
-- =============================================================================
-- Scoped to ONE job posting (v1), not the whole organisation: /employer/jobs
-- already renders one row per posting, and a per-job list is the natural
-- next screen from there — narrower to ship first, and nothing here
-- forecloses an org-wide variant later if that turns out to be needed.
--
-- Takes p_job_posting_id, not an organisation id at all: the function looks
-- up which org owns the posting itself and checks the CALLER's membership in
-- THAT org, so there is no org id argument for a caller to pass someone
-- else's value for — narrower than 0029's own shape, not just following it.
create or replace function public.employer_job_applicants(p_job_posting_id uuid)
returns table (
  application_id uuid,
  first_name text,
  last_name text,
  applied_at timestamp with time zone,
  resume_id uuid,
  status public.applicant_review_status
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    a.id,
    p.first_name,
    p.last_name,
    a.applied_at,
    a.resume_id,
    coalesce(s.status, 'new'::public.applicant_review_status)
  from public.applications a
  join public.job_postings j on j.id = a.job_posting_id
  join public.profiles p on p.id = a.user_id
  left join public.employer_applicant_status s on s.application_id = a.id
  where a.job_posting_id = p_job_posting_id
    -- The gate. Without this, any signed-in user could list applicants for
    -- any job posting by guessing its id.
    and public.is_org_member(j.organization_id)
    -- Actually applied, not merely saved/bookmarked — same predicate 0059
    -- uses, for the same reason: applied_at survives a later stage change,
    -- so this can never drop someone who applied and then archived the card
    -- in their own tracker, and never counts a bookmark as an applicant.
    and a.applied_at is not null
  order by a.applied_at desc;
$$;

revoke all on function public.employer_job_applicants(uuid) from public;
revoke all on function public.employer_job_applicants(uuid) from anon;
grant execute on function public.employer_job_applicants(uuid) to authenticated, service_role;

comment on function public.employer_job_applicants(uuid) is
  'Per-applicant rows for ONE job posting, scoped to the caller''s own organisation. Never returns email, applications.notes, or applications.stage (seeker-private, 0037) — only name, applied_at, resume_id, and the employer''s own status (default new).';

-- =============================================================================
-- 3. Resume view — reuses the seeker's own rendering path, invents no other
-- =============================================================================
-- Returns exactly what getTemplateComponent(slug) + structured_content need
-- to render (src/components/resume-builder/templates/index.tsx) — the same
-- two values the resume builder's own editor resolves via
-- resumes.template_id -> resume_templates.slug. No broader `resumes` access
-- is granted anywhere; this is the only door an employer has.
--
-- Keyed on p_application_id, not p_resume_id. The applicant list above
-- already returns application_id as the row's own identity, so that is what
-- the UI actually has in hand at the point it wants to view a resume — and
-- it is narrower than accepting a resume id directly, since it removes resume
-- id from being a value worth guessing or enumerating at all: nothing here
-- checks "is this resume attached to some application in my org", it checks
-- "is THIS APPLICATION, which I already know the id of because it's mine to
-- see, one whose job posting my org owns".
create or replace function public.employer_view_resume(p_application_id uuid)
returns table (
  structured_content jsonb,
  template_slug text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.structured_content, rt.slug
  from public.applications a
  join public.job_postings j on j.id = a.job_posting_id
  join public.resumes r on r.id = a.resume_id
  left join public.resume_templates rt on rt.id = r.template_id
  where a.id = p_application_id
    and public.is_org_member(j.organization_id);
$$;

revoke all on function public.employer_view_resume(uuid) from public;
revoke all on function public.employer_view_resume(uuid) from anon;
grant execute on function public.employer_view_resume(uuid) to authenticated, service_role;

comment on function public.employer_view_resume(uuid) is
  'A resume''s renderable content (structured_content + template slug) for ONE application, gated on the caller being a member of the organisation whose job posting that application is for. Returns nothing for any other application id, including a guessed or enumerated one, and nothing at all if the application has no resume attached.';
