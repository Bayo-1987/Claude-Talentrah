-- 0179 — multiple candidate assessment response files (send-365), the
-- other half of send-364's employer-side multi-file change. Sequenced
-- strictly after 0178 landed and was verified, per the founder's own
-- instruction, specifically so this could point at 0178's actual decisions
-- rather than guess in parallel and risk disagreeing with itself.
--
-- ── SAME SHAPE AS 0178, MIRRORED FOR SYMMETRY, WITH ONE REAL DIFFERENCE ────
--
-- job_posting_assessment_files (0178) is written by the EMPLOYER'S OWN
-- session client directly, through a real RLS "org members can manage"
-- policy, because the upload route calls it column-by-column as each file
-- arrives. application_assessment_submissions (0177) has NO client write
-- policy at all — every write goes through submit_assessment_response,
-- SECURITY DEFINER, because a submission is immutable once made and the
-- function's own guards (ownership, one-shot, exclusivity) are the actual
-- authority, not a policy a client request could otherwise satisfy in a
-- way the function wouldn't allow. application_assessment_response_files
-- inherits THAT stance, not 0178's: no insert/update/delete policy for any
-- client role, only a two-party SELECT (candidate or owning org, same
-- check the parent table's own SELECT policy already makes) — every write
-- happens inside submit_assessment_response, in the same transaction as
-- the parent row, or not at all.
--
-- Checked directly before writing this migration, not assumed: zero rows
-- in BOTH the hosted dev project and production have response_file_path
-- (or response_link) set at all — no employer or candidate has used this
-- feature's file-response path yet. So the column is dropped outright, no
-- backfill.
--
-- ── WHY THE RPC TAKES jsonb, NOT text[] OF PATHS ALONE ──────────────────────
--
-- application_assessment_response_files needs original_filename and
-- byte_size per file for display (same as 0178's own file table) — a bare
-- array of paths has nowhere to carry those. The whole point of moving
-- this into the RPC (rather than having the upload route insert each row
-- itself, the way 0178's employer-side route does) is ATOMICITY: the
-- parent submission row and every one of its file rows must land together
-- or not at all, inside the ONE transaction this SECURITY DEFINER
-- function's single call already is — a route inserting N rows across N
-- separate calls has no such guarantee, and a partial failure there could
-- leave files sitting in storage with no submission row ever pointing at
-- them. `p_response_files` is a jsonb array of
-- `{"path": ..., "originalFilename": ..., "byteSize": ...}` objects,
-- validated and inserted inside this one function body.
--
-- ── THE 5-FILE CAP NEEDS NO TRIGGER HERE, UNLIKE 0178's ─────────────────────
--
-- 0178's cap needed a trigger with an advisory lock because the employer's
-- upload route makes ONE DATABASE CALL PER FILE — a real race window
-- between two concurrent uploads for the same assessment. This RPC
-- receives ALL of a submission's files in ONE call and validates the count
-- before inserting any of them, all inside the single transaction a
-- PL/pgSQL function body already is — there is no second call that could
-- race the first, so the check-then-insert here is already atomic without
-- extra machinery. The pre-existing
-- `application_assessment_submissions_application_id_key` UNIQUE
-- constraint is the same story for immutability: even if two concurrent
-- calls both passed the "not already submitted" check, the second
-- INSERT would fail on that constraint — a real, DB-level guarantee this
-- migration doesn't need to add, only preserve (it isn't touched here).

create table public.application_assessment_response_files (
  id uuid not null default gen_random_uuid(),
  application_assessment_submission_id uuid not null,
  -- Denormalized, same reasoning as every other table in this feature.
  organization_id uuid not null,
  file_path text not null,
  original_filename text not null,
  byte_size integer not null,
  created_at timestamp with time zone not null default now(),
  constraint application_assessment_response_files_pkey primary key (id),
  constraint application_assessment_response_files_submission_id_fkey
    foreign key (application_assessment_submission_id) references public.application_assessment_submissions (id) on delete cascade,
  constraint application_assessment_response_files_organization_id_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade
);

comment on table public.application_assessment_response_files is
  'Up to 5 files (send-365, same placeholder cap as 0178''s job_posting_assessment_files) a candidate attaches to their assessment response. Written ONLY by submit_assessment_response, inside the same transaction as the parent application_assessment_submissions row — no direct client write policy exists, mirroring the parent table''s own "immutable, RPC-only" stance rather than 0178''s employer-side "caller''s own client" one. Readable by the submitting candidate or a member of the owning organisation, same two-party check the parent row''s own SELECT policy already makes.';

alter table public.application_assessment_response_files enable row level security;

create policy "candidate or owning org can read response files"
  on public.application_assessment_response_files
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.application_assessment_submissions s
      join public.applications a on a.id = s.application_id
      where s.id = application_assessment_response_files.application_assessment_submission_id
        and a.user_id = (select auth.uid())
    )
    or public.is_org_member(organization_id)
  );

-- Deliberately no insert/update/delete policy for any client role — see
-- this migration's own header on why that mirrors the parent table.

-- ── Widen submit_assessment_response: N files, not one, same atomicity ─────
--
-- The parameter list changes shape (text -> jsonb in the third position),
-- so the old 4-arg (uuid, text, text, text) overload is dropped first
-- rather than replaced — `create or replace` only replaces a function
-- whose argument types match exactly, and leaving the old one in place
-- alongside a new one would be a second, stale, still-callable overload.
drop function if exists public.submit_assessment_response(uuid, text, text, text);

create or replace function public.submit_assessment_response(
  p_application_id uuid,
  p_response_text text,
  p_response_files jsonb,
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
  v_files jsonb := coalesce(p_response_files, '[]'::jsonb);
  v_file jsonb;
  v_file_count integer;
  v_submission_id uuid;
begin
  if jsonb_typeof(v_files) <> 'array' then
    raise exception 'Response files must be a list.';
  end if;
  v_file_count := jsonb_array_length(v_files);

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

  if v_file_count > 0 and p_response_link is not null then
    raise exception 'A response can include uploaded files or a link, not both.';
  end if;

  if v_file_count > 5 then
    raise exception 'A response can include at most 5 files.';
  end if;

  -- Ownership prefix check per file, the same courtesy/clear-error check
  -- (not itself the security boundary — the storage insert policy is) the
  -- single-file version already made for its one path.
  for v_file in select * from jsonb_array_elements(v_files) loop
    if v_file ->> 'path' is null or (v_file ->> 'path') !~ ('^' || auth.uid()::text || '/') then
      raise exception 'One of those files was not uploaded by you.';
    end if;
  end loop;

  if exists (
    select 1 from public.application_assessment_submissions where application_id = p_application_id
  ) then
    raise exception 'A response has already been submitted for this application and cannot be revised.';
  end if;

  v_trimmed_text := nullif(regexp_replace(coalesce(p_response_text, ''), '^\s+|\s+$', '', 'g'), '');

  insert into public.application_assessment_submissions (
    application_id, job_posting_id, organization_id, response_text, response_link
  ) values (
    p_application_id, v_job_posting_id, v_organization_id, v_trimmed_text, p_response_link
  )
  returning id into v_submission_id;

  if v_file_count > 0 then
    insert into public.application_assessment_response_files (
      application_assessment_submission_id, organization_id, file_path, original_filename, byte_size
    )
    select
      v_submission_id,
      v_organization_id,
      f ->> 'path',
      f ->> 'originalFilename',
      (f ->> 'byteSize')::integer
    from jsonb_array_elements(v_files) as f;
  end if;

  return true;
end;
$$;

revoke all on function public.submit_assessment_response(uuid, text, jsonb, text) from public, anon;
grant execute on function public.submit_assessment_response(uuid, text, jsonb, text) to authenticated;

comment on function public.submit_assessment_response(uuid, text, jsonb, text) is
  'send-365 — widened from a single response_file_path to up to 5 files, inserted as child rows in the SAME transaction as the parent submission row (atomic: any exception rolls back both). Ownership derived from auth.uid(), never trusted from an argument. Refuses a second call per application (immutable) — the pre-existing application_assessment_submissions_application_id_key UNIQUE constraint backs this even under a genuine race between two concurrent calls, not just this function''s own check.';

-- ── can_access_assessment_submission: now resolves through the child table ─
--
-- The single-file version matched storage paths directly against
-- application_assessment_submissions.response_file_path — that column is
-- gone. A necessary consequence of moving files to a child table, not an
-- optional cleanup: CLAUDE.md's own lesson is to check every function that
-- reads a column being changed, not just the queries that were obviously
-- about it. Same EXECUTE-grant discipline as the original (0177's own
-- header): explicit, not left to a table-level default.
create or replace function public.can_access_assessment_submission(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.application_assessment_response_files f
    join public.application_assessment_submissions s on s.id = f.application_assessment_submission_id
    join public.applications a on a.id = s.application_id
    where f.file_path = p_object_path
      and (
        a.user_id = (select auth.uid())
        or public.is_org_member(f.organization_id)
      )
  );
$$;

revoke all on function public.can_access_assessment_submission(text) from public, anon;
grant execute on function public.can_access_assessment_submission(text) to authenticated, service_role;

comment on function public.can_access_assessment_submission(text) is
  'send-365 — rewritten to join through application_assessment_response_files (0179) instead of matching application_assessment_submissions.response_file_path directly, which no longer exists. Still the two-party check backing job-assessment-submissions'' storage read policy: the submitting candidate OR a member of the owning organisation. EXECUTE granted to authenticated explicitly — see 0177''s own header on why this is stated rather than left implicit.';

-- ── Drop the single-file column and its now-impossible-to-express CHECK ────
--
-- Storage path shape changes from `<uid>/<job>.<ext>` to
-- `<uid>/<job>/<file id>.<ext>` — confirmed directly against this
-- project's real storage.foldername behavior (not assumed, same check
-- 0178 already made for its own bucket): every one of the
-- job-assessment-submissions storage policies reads only
-- `(storage.foldername(name))[1]`, which is still the uploader's own
-- auth.uid() under the three-segment shape, so none of those policies
-- change here.
alter table public.application_assessment_submissions
  drop constraint application_assessment_submissions_response_exclusive_check;

alter table public.application_assessment_submissions
  drop column response_file_path;
