-- 0094 — Deleting a resume: make it possible, and make it not destroy history.
--
-- MIGRATION-BEARING. Held for founder approval before merge, per the standing
-- rule. Read this header before approving; the FK change and the new columns
-- are one decision, not two.
--
-- APPLY STATE: applied to the hosted CI project `dozaffzgqkbarxtlclsj` only,
-- recorded as `resume_delete_snapshot_0094`. Production `nytwbbzfpytctjsoczzq`
-- gets it ON MERGE, not before — nothing in this migration is destructive, but
-- the deployed build does not read the new columns yet and the FK change means
-- a delete that is refused today would start succeeding.
--
-- Since Stage 2, CI's own runs no longer touch the hosted CI project at all:
-- every job stands up an ephemeral local stack and replays supabase/migrations/
-- from 0000 (.github/actions/local-supabase). So the file in this directory is
-- what CI actually verifies, and the hosted apply above exists only so a local
-- `npx vitest` has the schema. The cross-branch collision the old shared
-- project caused no longer applies.
--
-- ---------------------------------------------------------------------------
-- What is wrong today
-- ---------------------------------------------------------------------------
-- `deleteResumeAction` exists in src/lib/resume-builder/actions.ts and is wired
-- to nothing. When it is finally wired to a button, it fails, and it fails
-- silently — five foreign keys point at `resumes` and four of them were
-- `NO ACTION`:
--
--     applications.resume_id                        NO ACTION
--     applications.cover_letter_id                  NO ACTION
--     job_tailoring_requests.tailored_resume_id     NO ACTION
--     job_tailoring_requests.tailored_cover_letter_id  NO ACTION
--     resume_builder_start_events.resume_id         SET NULL   (0093 — already correct)
--
-- Confirmed on the founder's own account: 3 of 8 resumes are referenced by a
-- `job_tailoring_requests` row, so deleting them raises 23503. And because a
-- rejected Supabase delete resolves with an `error` rather than throwing —
-- the class CLAUDE.md documents at length — the unchecked action reported
-- success either way. Both halves of that are fixed: the action now checks,
-- and the FKs stop refusing.
--
-- ---------------------------------------------------------------------------
-- Why the two tables are treated differently
-- ---------------------------------------------------------------------------
-- `job_tailoring_requests` is a log of "pasted a JD, got output". Losing the
-- pointer to a resume the user deliberately deleted costs nothing anybody
-- would come looking for, so it gets a bare SET NULL and no snapshot.
--
-- `applications` is not that. The tracker's "Resume used" link is the only
-- answer the product has to "what did I actually send these people?", and a
-- user's application history is not disposable — deleting a draft resume must
-- not silently erase the record of an application already sent with it. So
-- `applications` gets SET NULL *and* a frozen copy, captured at delete time.
--
-- THE SHAPE IS DELIBERATELY THE ONE ALREADY ON THIS TABLE. `manual_job_snapshot`
-- (0000_baseline_schema.sql) is the same idea for the same reason: a jsonb
-- column holding what a row would otherwise have had to join to, so the row
-- stays readable when the joined thing is gone. `job_reference_check` already
-- enforces "a live posting OR a snapshot" for the job side. This is that
-- pattern applied to the resume side, and a reviewer who understands one
-- understands the other.
--
-- WHY THE SNAPSHOT COLUMNS SHIP IN THIS MIGRATION AND NOT A LATER ONE: a
-- snapshot column added after the FK starts nulling cannot recover a resume
-- that was already deleted in the gap. The FK columns are already nullable, so
-- SET NULL costs nothing extra to add now — the two changes are only safe
-- together, and shipping the FK first would open a window in which real
-- history is destroyed and no later migration can reconstruct it.
--
-- ---------------------------------------------------------------------------
-- Why a function, and what it actually guarantees
-- ---------------------------------------------------------------------------
-- Copy-then-delete in JS is two statements, and the gap between them is a
-- place to lose data: a crash, a timeout, or a concurrent `saveResumeAction`
-- between the read and the delete produces either a snapshot of content that
-- was never sent, or a deleted resume with no snapshot at all. Same reasoning
-- as `spend_credits_atomic` (0035) and `auto_apply_claim_submission` (0034):
-- the check and the act happen in one statement, under one lock, in the
-- database.
--
-- `select … for update` on the resume row is the lock. A concurrent save on
-- the same resume serialises behind it, so the snapshot is provably the
-- content that existed at the moment of deletion.
--
-- SECURITY DEFINER IS FOR ATOMICITY, NOT FOR PERMISSION — checked rather than
-- assumed. `resumes` carries "resumes are owner-only ... for all", so the
-- owner already holds DELETE on their own row by policy; the function is not
-- reaching around a restriction. But it must also UPDATE `applications` rows
-- in the same transaction, and definer rights are what keep that one unit.
--
-- The ownership check is therefore written out explicitly inside the function
-- anyway — `where r.id = p_resume_id and r.user_id = p_user_id` — because
-- definer rights turn off the RLS that would otherwise have enforced it. This
-- repo's own history is the argument: the thing that reads as safe because
-- something else is presumed to be checking is exactly what 0026 and 0028 were.
--
-- Grant is service_role only, matching 0034/0035. `p_user_id` comes from a
-- session the Server Action has already verified; granting EXECUTE to
-- `authenticated` would turn that argument into a forgeable authorisation and
-- hand any signed-in user every other user's resumes.
--
-- The `applications` update is scoped to `a.user_id = p_user_id` as well as to
-- the resume id. `applications.resume_id` is a plain FK with no ownership
-- constraint and 0041 deliberately left the column user-writable, so another
-- user's row *can* point at this resume. Such a row still gets nulled by the
-- FK, which is right, but it must not receive a copy of someone else's resume
-- content — that would be this migration inventing a data leak.
--
-- ---------------------------------------------------------------------------
-- Swept and deliberately left alone: applications' column grants
-- ---------------------------------------------------------------------------
-- Named explicitly because CLAUDE.md says adding a value-bearing column to a
-- user-writable table is a decision, not a default. `applications` still holds
-- a table-wide UPDATE grant for `authenticated`, so these two columns are
-- writable by their owner, and 0041 swept this table and chose to leave it
-- that way: "the tracker is the user's own record".
--
-- That reasoning holds here. The snapshot is the user's own history, kept for
-- their benefit, not evidence held against them — anyone who could rewrite it
-- could equally delete the whole application row, which nothing prevents and
-- nothing should. It carries no money, no trust and no identity.
--
-- Locking it would mean revoking UPDATE on `applications` and re-granting an
-- enumerated column list, and that list has to cover the auto-apply upsert's
-- conflict-update set as well as every action's writes — a materially larger
-- change than this one, on paths CLAUDE.md notes are thinly tested. Recorded
-- as a deliberate no rather than an oversight; revisit it as its own change if
-- the founder wants the tracker to be tamper-evident.

-- ---------------------------------------------------------------------------
-- 1. The snapshot columns
-- ---------------------------------------------------------------------------
alter table public.applications
  add column if not exists resume_snapshot jsonb,
  add column if not exists cover_letter_snapshot jsonb;

comment on column public.applications.resume_snapshot is
  'Frozen copy of the resume this application was sent with, written by delete_resume_with_snapshot at the moment the resume is deleted. Null while resume_id still points at a live row. Same pattern and purpose as manual_job_snapshot.';
comment on column public.applications.cover_letter_snapshot is
  'As resume_snapshot, for cover_letter_id. Cover letters are stored as rows in `resumes`.';

-- ---------------------------------------------------------------------------
-- 2. The foreign keys
--
-- Dropped and recreated rather than altered: Postgres has no
-- `alter constraint ... on delete` for foreign keys. Names are preserved
-- exactly so `information_schema` and the generated types keep matching.
-- ---------------------------------------------------------------------------
alter table public.applications
  drop constraint applications_resume_id_fkey,
  add constraint applications_resume_id_fkey
    foreign key (resume_id) references public.resumes(id) on delete set null;

alter table public.applications
  drop constraint applications_cover_letter_id_fkey,
  add constraint applications_cover_letter_id_fkey
    foreign key (cover_letter_id) references public.resumes(id) on delete set null;

alter table public.job_tailoring_requests
  drop constraint job_tailoring_requests_tailored_resume_id_fkey,
  add constraint job_tailoring_requests_tailored_resume_id_fkey
    foreign key (tailored_resume_id) references public.resumes(id) on delete set null;

alter table public.job_tailoring_requests
  drop constraint job_tailoring_requests_tailored_cover_letter_id_fkey,
  add constraint job_tailoring_requests_tailored_cover_letter_id_fkey
    foreign key (tailored_cover_letter_id) references public.resumes(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 3. Indexes on the referencing columns
--
-- Postgres does not index a foreign key's referencing side automatically, and
-- SET NULL means every resume delete now scans each referencing table to find
-- the rows to null. Four partial indexes, because both columns on both tables
-- are null for the overwhelming majority of rows (nothing in the app has ever
-- written cover_letter_id at all).
-- ---------------------------------------------------------------------------
create index if not exists applications_resume_id_idx
  on public.applications (resume_id) where resume_id is not null;
create index if not exists applications_cover_letter_id_idx
  on public.applications (cover_letter_id) where cover_letter_id is not null;
create index if not exists job_tailoring_requests_tailored_resume_id_idx
  on public.job_tailoring_requests (tailored_resume_id) where tailored_resume_id is not null;
create index if not exists job_tailoring_requests_tailored_cover_letter_id_idx
  on public.job_tailoring_requests (tailored_cover_letter_id) where tailored_cover_letter_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Snapshot-then-delete, as one statement's worth of work
--
-- Returns a verdict rather than raising, for every outcome the caller can do
-- something about. A raised exception would reach the Server Action as an
-- opaque Postgres string it would have to pattern-match to tell "not yours"
-- from "that's your base resume" from "the database is down" — and a caller
-- parsing error text is a caller that breaks on a Postgres upgrade.
--
-- `reason` values, all three of which the UI distinguishes:
--   'not_found'    no such resume, or it is not this user's
--   'base_resume'  it is the is_base row; never deletable
--   null           ok
-- ---------------------------------------------------------------------------
create or replace function public.delete_resume_with_snapshot(
  p_user_id uuid,
  p_resume_id uuid
)
returns table (ok boolean, reason text, applications_snapshotted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_content jsonb;
  v_is_base boolean;
  v_snapshotted integer := 0;
  v_captured_at timestamptz := now();
begin
  -- The lock. Everything below reads the content this returned, so a
  -- concurrent saveResumeAction on the same resume waits here and the
  -- snapshot is provably what existed at deletion time.
  select r.title, r.structured_content, r.is_base
    into v_title, v_content, v_is_base
    from public.resumes r
   where r.id = p_resume_id
     and r.user_id = p_user_id
     for update;

  -- Ownership and existence are the same answer on purpose: a caller must not
  -- be able to tell "someone else owns this id" from "no such id", or the
  -- function becomes an oracle for which resume ids exist.
  if not found then
    return query select false, 'not_found'::text, 0;
    return;
  end if;

  -- The base resume is what Auto-Apply submits on the user's behalf. It has
  -- never been deletable and this does not change that.
  if v_is_base then
    return query select false, 'base_resume'::text, 0;
    return;
  end if;

  -- One UPDATE covers both columns, because a single application could
  -- legitimately reference the same resume row in both (nothing creates that
  -- today, but the FK permits it) and two statements would take two locks in
  -- an order nothing pins.
  with snapshotted as (
    update public.applications a
       set resume_snapshot = case
             when a.resume_id = p_resume_id then jsonb_build_object(
               'resumeId', p_resume_id,
               'title', v_title,
               'structuredContent', v_content,
               'capturedAt', v_captured_at
             )
             else a.resume_snapshot
           end,
         cover_letter_snapshot = case
             when a.cover_letter_id = p_resume_id then jsonb_build_object(
               'resumeId', p_resume_id,
               'title', v_title,
               'structuredContent', v_content,
               'capturedAt', v_captured_at
             )
             else a.cover_letter_snapshot
           end
     where a.user_id = p_user_id
       and (a.resume_id = p_resume_id or a.cover_letter_id = p_resume_id)
    returning a.id
  )
  select count(*)::integer into v_snapshotted from snapshotted;

  -- `is_base = false` restated on the delete itself. Redundant against the
  -- check above within this transaction, and kept anyway: it is the one line
  -- that makes the guarantee true no matter how the function is later edited.
  delete from public.resumes r
   where r.id = p_resume_id
     and r.user_id = p_user_id
     and r.is_base = false;

  return query select true, null::text, v_snapshotted;
end;
$$;

revoke all on function public.delete_resume_with_snapshot(uuid, uuid) from public;
revoke all on function public.delete_resume_with_snapshot(uuid, uuid) from anon;
revoke all on function public.delete_resume_with_snapshot(uuid, uuid) from authenticated;
grant execute on function public.delete_resume_with_snapshot(uuid, uuid) to service_role;
