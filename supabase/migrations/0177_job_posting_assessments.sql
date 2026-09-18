-- 0177 — employer assessment attachments (v2, supersedes an earlier
-- send-361 draft entirely, not an amendment to it). An employer can attach
-- ONE assessment to a job posting: instructions plus an uploaded document
-- or a link. A seeker applying to that posting submits their own response
-- — text, an uploaded file, or a link — as part of the SAME apply action
-- that already submits their resume and any screening-question answers.
--
-- ── WHY THIS IS ATTACHED TO THE POSTING, NOT SENT TO INDIVIDUAL APPLICANTS ──
--
-- The superseded draft had an employer send a request to specific
-- applicants after the fact, with a due date. This version has no "due
-- date" concept at all — the deadline is simply "before you finish
-- applying" — because the assessment is part of the posting itself, the
-- same way a screening question already is (0171).
--
-- ── TWO TABLES, EACH 0-OR-1 PER PARENT, SAME SHAPE AS THE BANNER ────────────
--
-- job_posting_assessments: at most one row per posting (unique on
-- job_posting_id), the same "0-or-1" cardinality job_postings.banner_path
-- already has (0115) — this is a second column-shaped concept that outgrew
-- a column because it needs more than one field (title, instructions, an
-- exercise, a required flag).
--
-- application_assessment_submissions: at most one row per application
-- (unique on application_id) — a candidate submits once, the same
-- immutability stance application_screening_answers (0171) already takes
-- for the identical reason (a self-submission must not be revisable once
-- the employer might already be looking at it).
--
-- organization_id IS DENORMALIZED ON BOTH TABLES, deliberately, so RLS can
-- check it as a plain column rather than joining to job_postings on every
-- row — the same reasoning already applied elsewhere in this schema for a
-- table that needs org-scoped access without paying a join per check.
--
-- ── TIER VOCABULARY N/A: THIS IS NEVER GRADED ───────────────────────────────
--
-- There is no pass/fail here, matching free_text screening questions
-- (0175) — an assessment submission is something for a human recruiter to
-- read, not something this schema scores. `required` only ever gates
-- whether the APPLY FLOW lets the candidate finish without submitting one
-- — enforced client-side (disabling submit, the same way ScreeningGateApply
-- already disables its own submit for a missing required answer) — there is
-- deliberately no server-side hard block here either, matching 0171's own
-- "self-reported, never blocks" philosophy: a required assessment that a
-- candidate skips because of a client bug should not trap their whole
-- application unsubmittable.

create table public.job_posting_assessments (
  id uuid not null default gen_random_uuid(),
  job_posting_id uuid not null,
  organization_id uuid not null,
  title text not null,
  instructions text not null,
  -- Alternatives, not both — an employer either uploads the exercise
  -- document or links to where it already lives; forcing a re-upload of
  -- something already hosted elsewhere would be a worse experience than
  -- just taking the link.
  exercise_file_path text,
  exercise_link text,
  required boolean not null default true,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint job_posting_assessments_pkey primary key (id),
  constraint job_posting_assessments_job_posting_id_key unique (job_posting_id),
  constraint job_posting_assessments_job_posting_id_fkey
    foreign key (job_posting_id) references public.job_postings (id) on delete cascade,
  constraint job_posting_assessments_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint job_posting_assessments_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null,
  constraint job_posting_assessments_exercise_exclusive_check
    check (not (exercise_file_path is not null and exercise_link is not null))
);

comment on table public.job_posting_assessments is
  'At most one optional assessment per job posting (send-346 v2, supersedes an earlier per-applicant send-361 draft entirely). Readable by anyone who can read the job posting itself — same "no more sensitive than the description" stance the job-banners bucket (0115) already takes for its own file. Writable only by the owning org.';

create table public.application_assessment_submissions (
  id uuid not null default gen_random_uuid(),
  application_id uuid not null,
  job_posting_id uuid not null,
  organization_id uuid not null,
  response_text text,
  response_file_path text,
  response_link text,
  submitted_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  constraint application_assessment_submissions_pkey primary key (id),
  constraint application_assessment_submissions_application_id_key unique (application_id),
  constraint application_assessment_submissions_application_id_fkey
    foreign key (application_id) references public.applications (id) on delete cascade,
  constraint application_assessment_submissions_job_posting_id_fkey
    foreign key (job_posting_id) references public.job_postings (id) on delete cascade,
  constraint application_assessment_submissions_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint application_assessment_submissions_response_exclusive_check
    check (not (response_file_path is not null and response_link is not null))
);

comment on table public.application_assessment_submissions is
  'A candidate''s one-time response to a job posting''s assessment (send-346 v2) — text, an uploaded file, or a link, never more than one submission per application. Never graded: nothing here computes a pass/fail the way application_screening_answers does. Readable by the submitting candidate AND by a member of the owning organisation — see this migration''s storage policies for the equivalent, more complex two-party check on the actual FILE this row can point to.';

alter table public.job_posting_assessments enable row level security;
alter table public.application_assessment_submissions enable row level security;

-- Same shape as job_posting_screening_questions' own "publicly readable"
-- policy (0171): an assessment's instructions render on the public apply
-- flow for a signed-in seeker, and (per this migration's own storage
-- bucket choice below) the exercise file itself is no more sensitive than
-- the job description text already sitting right next to it.
create policy "job posting assessments are publicly readable" on public.job_posting_assessments
  for select using (true);

-- Same shape as job_posting_screening_questions' own management policy
-- (0171), with one addition: the WITH CHECK also re-verifies the
-- denormalized organization_id actually matches the posting's own —
-- job_postings carries a table-level INSERT grant for `authenticated`
-- (0056 only ever revoked UPDATE), so a hand-crafted request could
-- otherwise claim organization_id for an org the caller is a genuine
-- member of while pointing job_posting_id at a DIFFERENT org's posting.
-- Tying both together at write time is what makes that combination refused
-- rather than merely unlikely.
create policy "org members can manage their own postings' assessment"
  on public.job_posting_assessments
  for all
  to authenticated
  using (
    exists (
      select 1 from public.job_postings j
      where j.id = job_posting_assessments.job_posting_id
        and j.organization_id = job_posting_assessments.organization_id
        and j.source_type = 'internal'::job_source_type
        and public.is_org_member(j.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.job_postings j
      where j.id = job_posting_assessments.job_posting_id
        and j.organization_id = job_posting_assessments.organization_id
        and j.source_type = 'internal'::job_source_type
        and public.is_org_member(j.organization_id)
    )
  );

-- The submitting candidate reads their own row, OR a member of the owning
-- organisation reads it — the two-party read TABLE policy is simple (an OR
-- of two independently checkable things); the equivalent STORAGE policy
-- below is not, because storage.objects has no application_id column to
-- join through directly.
create policy "candidate or owning org can read an assessment submission"
  on public.application_assessment_submissions
  for select
  to authenticated
  using (
    exists (
      select 1 from public.applications a
      where a.id = application_assessment_submissions.application_id
        and a.user_id = (select auth.uid())
    )
    or public.is_org_member(organization_id)
  );

-- Deliberately NO insert/update/delete policy on
-- application_assessment_submissions for any role — every write goes
-- through submit_assessment_response() below, which is SECURITY DEFINER
-- and does its own ownership + immutability checks, the exact same
-- division 0171 already draws for application_screening_answers.

-- ── submit_assessment_response: the one write path, additive to the apply
--    flow, never blocking it ──────────────────────────────────────────────
--
-- Mirrors submit_screening_answers' own shape: derive ownership from
-- auth.uid() rather than trust an argument, refuse a second call for an
-- application that already has a submission, and validate the exclusivity
-- rule the table's own CHECK constraint also enforces (belt and braces —
-- the constraint is the real backstop; this gives a clear error message
-- instead of a raw constraint-violation one).
create or replace function public.submit_assessment_response(
  p_application_id uuid,
  p_response_text text,
  p_response_file_path text,
  p_response_link text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_posting_id uuid;
  v_organization_id uuid;
  v_trimmed_text text;
begin
  select a.job_posting_id, j.organization_id
    into v_job_posting_id, v_organization_id
  from public.applications a
  join public.job_postings j on j.id = a.job_posting_id
  where a.id = p_application_id and a.user_id = auth.uid();

  if v_job_posting_id is null then
    raise exception 'No such application for the current user.';
  end if;

  if not exists (
    select 1 from public.job_posting_assessments where job_posting_id = v_job_posting_id
  ) then
    raise exception 'This job posting has no assessment to respond to.';
  end if;

  if p_response_file_path is not null and p_response_link is not null then
    raise exception 'A response can include an uploaded file or a link, not both.';
  end if;

  -- The uploaded file (if any) must live in the CALLER'S OWN storage
  -- folder — see this migration's storage insert policy on
  -- job-assessment-submissions, which is the actual authority for who may
  -- have written that path. This is a courtesy check that turns a
  -- mismatched path into a clear error here rather than a silently broken
  -- link the employer discovers later; it is not itself the security
  -- boundary.
  if p_response_file_path is not null and p_response_file_path !~ ('^' || auth.uid()::text || '/') then
    raise exception 'That file was not uploaded by you.';
  end if;

  if exists (
    select 1 from public.application_assessment_submissions where application_id = p_application_id
  ) then
    raise exception 'A response has already been submitted for this application and cannot be revised.';
  end if;

  v_trimmed_text := nullif(regexp_replace(coalesce(p_response_text, ''), '^\s+|\s+$', '', 'g'), '');

  insert into public.application_assessment_submissions (
    application_id, job_posting_id, organization_id, response_text, response_file_path, response_link
  ) values (
    p_application_id, v_job_posting_id, v_organization_id, v_trimmed_text, p_response_file_path, p_response_link
  );

  return true;
end;
$$;

revoke all on function public.submit_assessment_response(uuid, text, text, text) from public, anon;
grant execute on function public.submit_assessment_response(uuid, text, text, text) to authenticated;

comment on function public.submit_assessment_response(uuid, text, text, text) is
  'send-346 v2 — the one write path for a candidate''s assessment response. Ownership derived from auth.uid(), never trusted from an argument. Refuses a second call per application (immutable, same stance as submit_screening_answers). Never touches applications.screening_passed or any grading — this is purely a submission record for a human to read.';

-- ── Storage: two buckets, deliberately different shapes ─────────────────────
--
-- job-assessment-exercises: PUBLIC read, identical shape to job-banners
-- (0115) — the employer's own instructions document is no more sensitive
-- than the job description text that's already fully public. Write is
-- org-scoped exactly the way 0115 already gates banner uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-assessment-exercises',
  'job-assessment-exercises',
  true,
  5242880, -- 5 MB, matching /api/resume/parse's own MAX_SIZE_BYTES
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "job assessment exercises are writable by the owning org"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-assessment-exercises'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "job assessment exercises are replaceable by the owning org"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'job-assessment-exercises'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "job assessment exercises are deletable by the owning org"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'job-assessment-exercises'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy "job assessment exercises are publicly readable"
  on storage.objects
  for select
  using (bucket_id = 'job-assessment-exercises');

-- job-assessment-submissions: PRIVATE. No public read at all. A
-- candidate's submission needs to be readable by exactly two parties: the
-- candidate who submitted it, and a member of the organisation that owns
-- the job posting it was submitted to. This is a MEANINGFULLY DIFFERENT,
-- more complex policy than job-banners' single-party check — read the
-- comment on can_access_assessment_submission below before touching either
-- policy that calls it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-assessment-submissions',
  'job-assessment-submissions',
  false,
  5242880,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path shape: <uploader's own auth.uid()>/<job_posting_id>.<ext> — chosen
-- because at UPLOAD time (before the candidate has finished applying) no
-- application row exists yet to join through, so the write policy below
-- can only ever be self-contained: "you may write into your own folder,"
-- nothing more. The two-party READ policy is what has real complexity —
-- see the function below.
create policy "assessment submission files are writable by their own uploader"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-assessment-submissions'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- UPDATE (not just INSERT) so a candidate who changes their mind about
-- which file to attach before finishing the apply flow can re-upload at
-- the SAME path (upsert) rather than needing a delete policy too.
create policy "assessment submission files are replaceable by their own uploader"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'job-assessment-submissions'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ── can_access_assessment_submission: the two-party read check ─────────────
--
-- Resolves an object path back to application_assessment_submissions, then
-- to EITHER party who may legitimately read it:
--   * the candidate — applications.user_id = auth.uid(), OR
--   * an org member — is_org_member(organization_id), the row's own
--     denormalized column, no join to job_postings needed.
--
-- CLAUDE.md's own recorded lesson, verbatim, applies here even though it
-- was written about a TABLE RLS policy: "If an RLS policy calls a
-- function, every role that evaluates that policy needs EXECUTE on it —
-- including anon." This is a STORAGE policy calling a function, a new
-- enough shape in this codebase to over-flag rather than assume it will be
-- caught. Both storage policies that call this are scoped `to
-- authenticated` only (this bucket has no anon/public access at all), so
-- the grant below only needs to cover `authenticated` — but it is stated
-- explicitly, not left to a table-level default, for exactly the reason
-- 0027 became a real incident: a forgotten grant here is not a compile
-- error, it is every read silently returning false.
create or replace function public.can_access_assessment_submission(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.application_assessment_submissions s
    join public.applications a on a.id = s.application_id
    where s.response_file_path = p_object_path
      and (
        a.user_id = (select auth.uid())
        or public.is_org_member(s.organization_id)
      )
  );
$$;

revoke all on function public.can_access_assessment_submission(text) from public, anon;
grant execute on function public.can_access_assessment_submission(text) to authenticated, service_role;

comment on function public.can_access_assessment_submission(text) is
  'send-346 v2 — the two-party check backing job-assessment-submissions'' read policy: the submitting candidate OR a member of the owning organisation. EXECUTE is granted to authenticated explicitly (0027''s own lesson: a storage/RLS policy calling a function with no grant is a silent denial for every role the grant was forgotten for) — this bucket has no anon policy at all, so authenticated is the only role that ever evaluates it.';

-- The read policy itself: EITHER the per-uploader-folder shortcut (covers
-- the brief window between a file upload and the apply action's own row
-- write, when no application_assessment_submissions row exists yet to
-- look up) OR the two-party function above (covers both parties once the
-- row exists, including the org member the folder-shortcut alone could
-- never grant).
create policy "assessment submissions are readable by candidate or owning org"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'job-assessment-submissions'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.can_access_assessment_submission(name)
    )
  );

-- send-345/send-361's own rate-limit precedent (0115's jobBannerUpload) —
-- new buckets, new keys, added in src/lib/api/rate-limit.ts, not here; this
-- comment exists only so a reader of this migration knows to look there.
