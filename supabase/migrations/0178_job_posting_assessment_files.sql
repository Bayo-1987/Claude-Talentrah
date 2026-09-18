-- 0178 — multiple assessment exercise files, and letting an employer attach
-- them while CREATING a job posting (send-364), not just from Edit.
--
-- ── WHY THIS REPLACES A COLUMN WITH A TABLE ────────────────────────────────
--
-- 0177 gave `job_posting_assessments` a single nullable `exercise_file_path`
-- column — correct for "at most one file," wrong for "up to five." One
-- posting's assessment having N files is a real one-to-many relationship,
-- not a wider column.
--
-- Checked directly before writing this migration, not assumed: zero rows in
-- BOTH the hosted dev project and production have `exercise_file_path` (or
-- `exercise_link`) set at all — this feature shipped very recently and no
-- employer has used it yet. So this migration drops the column outright,
-- with no backfill into the new table, because there is genuinely nothing
-- to carry over.
--
-- ── THE EXCLUSIVITY RULE CAN NO LONGER BE A CHECK CONSTRAINT ───────────────
--
-- 0177's `job_posting_assessments_exercise_exclusive_check` enforced
-- "a file and a link are alternatives, not both" with a single-table CHECK.
-- Postgres cannot CHECK across tables, and `exercise_link` still lives on
-- the parent row while files now live here. This migration does NOT replace
-- it with a trigger — matching 0177's own already-established "self-
-- reported, no server-side hard block" philosophy for `required` (see that
-- migration's own header on that choice): setting a link deletes any
-- existing file rows, and adding a file clears any existing link, both
-- enforced in application code (reconcileJobPostingAssessment and the
-- upload route), not in the database. A DB-trigger-enforced hard guarantee
-- is available if the founder specifically wants one later; this is
-- deliberately the simpler option, consistent with the file's existing tone.
--
-- ── THE 5-FILE CAP IS A PLACEHOLDER, LIKE OTHER PICKED-NOT-RESEARCHED
--    NUMBERS IN THIS REPO (e.g. billing/catalog.ts's ₦100/review price) ────
--
-- Small, explainable, not derived from any real usage data. Enforced here
-- via a trigger (not just in the UI or the route's own pre-check) because
-- CLAUDE.md's own standing rule is that anything gating on a counted value
-- must check-and-act atomically — a plain "count, then insert" from the API
-- route has a race window between two concurrent uploads. The trigger takes
-- a per-assessment advisory lock before counting, which closes that window;
-- it does not need SECURITY DEFINER because job_posting_assessment_files'
-- own SELECT policy is `using (true)` below (same "no more sensitive than
-- the job description" stance the parent table and the exercises bucket
-- already take), so the count query succeeds under the invoking role's own
-- RLS regardless of who is uploading.
--
-- ── STORAGE PATH SHAPE CHANGES, THE POLICY DOES NOT ────────────────────────
--
-- `<organization_id>/<job_posting_id>.<ext>` (one object) becomes
-- `<organization_id>/<job_posting_id>/<file_id>.<ext>` (a folder of
-- objects). Confirmed directly against this project's real
-- `storage.foldername` behavior before writing this migration, not assumed:
--   select storage.foldername('org123/job456/file789.pdf');  -- {org123,job456}
--   select (storage.foldername('org123/job456/file789.pdf'))[1];  -- 'org123'
-- Every one of 0177's four `job-assessment-exercises` storage policies reads
-- only `(storage.foldername(name))[1]` — the first path segment, still the
-- organisation id under the new three-segment shape — so none of them need
-- to change. This migration adds no new storage policies at all.

create table public.job_posting_assessment_files (
  id uuid not null default gen_random_uuid(),
  job_posting_assessment_id uuid not null,
  -- Denormalized, same reasoning 0177 already gives for organization_id on
  -- both of its own tables: RLS checks it as a plain column rather than
  -- joining to job_posting_assessments -> job_postings on every row.
  organization_id uuid not null,
  file_path text not null,
  -- For display. The stored path is an opaque <file id>.<ext>, not this.
  original_filename text not null,
  byte_size integer not null,
  created_at timestamp with time zone not null default now(),
  constraint job_posting_assessment_files_pkey primary key (id),
  constraint job_posting_assessment_files_assessment_id_fkey
    foreign key (job_posting_assessment_id) references public.job_posting_assessments (id) on delete cascade,
  constraint job_posting_assessment_files_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade
);

comment on table public.job_posting_assessment_files is
  'Up to 5 files (send-364, placeholder cap — see enforce_max_assessment_files) an employer attaches to their job posting''s assessment (0177). Publicly readable, same "no more sensitive than the job description" stance job_posting_assessments and the job-assessment-exercises bucket already take. Written only by the owning org, and only through reconcileJobPostingAssessment / /api/employer/job-assessment-exercise — never a raw client insert into an arbitrary path.';

alter table public.job_posting_assessment_files enable row level security;

create policy "job posting assessment files are publicly readable" on public.job_posting_assessment_files
  for select using (true);

-- Same shape as 0177's own "org members can manage their own postings'
-- assessment" policy, one join deeper: job_posting_assessment_id ->
-- job_posting_assessments.job_posting_id -> job_postings.organization_id.
-- The WITH CHECK also re-verifies organization_id matches, for the identical
-- reason 0177 gives on its own parent-table policy: job_posting_assessments
-- carries a table-level INSERT grant for `authenticated`, so a hand-crafted
-- request could otherwise claim organization_id for an org the caller
-- genuinely belongs to while pointing job_posting_assessment_id at a
-- DIFFERENT org's assessment.
create policy "org members can manage their own assessment's files"
  on public.job_posting_assessment_files
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.job_posting_assessments a
      join public.job_postings j on j.id = a.job_posting_id
      where a.id = job_posting_assessment_files.job_posting_assessment_id
        and a.organization_id = job_posting_assessment_files.organization_id
        and j.organization_id = job_posting_assessment_files.organization_id
        and j.source_type = 'internal'::job_source_type
        and public.is_org_member(j.organization_id)
    )
  )
  with check (
    exists (
      select 1
      from public.job_posting_assessments a
      join public.job_postings j on j.id = a.job_posting_id
      where a.id = job_posting_assessment_files.job_posting_assessment_id
        and a.organization_id = job_posting_assessment_files.organization_id
        and j.organization_id = job_posting_assessment_files.organization_id
        and j.source_type = 'internal'::job_source_type
        and public.is_org_member(j.organization_id)
    )
  );

-- ── The cap, enforced atomically, not "count then insert" ──────────────────
--
-- pg_advisory_xact_lock serializes concurrent inserts for the SAME
-- assessment (released automatically at transaction end, so no separate
-- unlock is needed and a failed/rolled-back insert can't leak the lock).
-- Two uploads for TWO DIFFERENT assessments never contend with each other —
-- hashtextextended(uuid text, 0) gives each assessment id its own lock key.
create or replace function public.enforce_max_assessment_files()
returns trigger
language plpgsql
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.job_posting_assessment_id::text, 0));

  select count(*) into v_count
  from public.job_posting_assessment_files
  where job_posting_assessment_id = new.job_posting_assessment_id;

  if v_count >= 5 then
    raise exception 'An assessment can have at most 5 files attached.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_max_assessment_files() is
  'send-364 — the 5-file cap''s real enforcement (the API route''s own pre-check is just a nicer error message; this is what actually cannot be raced). Takes a per-assessment advisory lock before counting, closing the "two concurrent uploads both see count=4" window a plain count-then-insert would leave open.';

create trigger job_posting_assessment_files_cap
  before insert on public.job_posting_assessment_files
  for each row execute function public.enforce_max_assessment_files();

-- ── Drop the single-file column and its now-impossible-to-express CHECK ────
alter table public.job_posting_assessments
  drop constraint job_posting_assessments_exercise_exclusive_check;

alter table public.job_posting_assessments
  drop column exercise_file_path;
