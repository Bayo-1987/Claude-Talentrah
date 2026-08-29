-- 0064 — record WHICH operator moderated, not just that one did.
--
-- ── WHAT WAS MISSING ─────────────────────────────────────────────────────
--
-- All three moderation routes say the same thing in their own comments: a
-- shared secret proves "an operator" and never "which operator", so recording
-- a caller-supplied id would render a self-asserted claim as attribution —
-- worse than an honest null, because a null is visibly missing and a wrong
-- name is not. They were right, and 0060 removed the reason:
-- `admin_users.id` IS the `auth.users`/`profiles` id, so there is now a real
-- identity to point at.
--
-- The columns are not uniformly present, which is the actual work here:
--
--   ad_campaigns.reviewed_by   ALREADY EXISTS (fk -> profiles). Only the
--                              application was passing null; no DDL needed.
--   scholarships               has moderated_at and moderation_note, and NO
--                              moderated_by at all.
--   job_postings               has removed_at and removal_reason, and NO
--                              removed_by at all.
--
-- So two thirds of the "wire up the nulls" job is a schema change, and
-- discovering that at the point of writing the screen would have been the
-- wrong time.
--
-- ── WHY THEY POINT AT profiles, NOT admin_users ──────────────────────────
--
-- To match `ad_campaigns.reviewed_by`, which already points at `profiles`.
-- One id space for "a person who did something", not two. `admin_users.id` is
-- a `profiles.id`, so an admin is always resolvable through either — and an
-- operator whose admin rights are later revoked still resolves as a person
-- here, which is what an audit trail needs. Pointing at `admin_users` would
-- mean a revoked operator's past decisions dangled.
--
-- ON DELETE SET NULL, deliberately, and the same reasoning as
-- `admin_audit_log.admin_user_id`: NFR §8 requires account deletion to be
-- real, and a moderation decision must survive the deletion of the person who
-- made it. It degrades to the honest null these columns already had, rather
-- than cascading a scholarship or a job posting out of existence because an
-- operator closed their account.
--
-- ── NOT WRITABLE BY ANY CLIENT ───────────────────────────────────────────
--
-- Both tables are already locked against the roles that could reach them —
-- `job_postings` has no UPDATE policy for `authenticated` outside the
-- org-owner path, and `scholarships` is service-role-write only. The revokes
-- below are belt and braces in the 0028/0030 style rather than a fix for a
-- known hole: these are columns that assert WHO DID SOMETHING, which is
-- exactly the class of value CLAUDE.md says must be a grant and not a policy.
-- A permissive policy added later must not silently make them writable.

alter table public.scholarships
  add column moderated_by uuid references public.profiles(id) on delete set null;

alter table public.job_postings
  add column removed_by uuid references public.profiles(id) on delete set null;

comment on column public.scholarships.moderated_by is
  'The admin who approved or rejected this listing. Null for decisions made before 0064, when the shared-secret routes could not name an operator.';

comment on column public.job_postings.removed_by is
  'The admin who removed or restored this posting. Null for decisions made before 0064. Set together with removed_at; a restore clears both.';

-- ── THE ORDER HERE IS THE WHOLE POINT, AND THE FIRST DRAFT GOT IT WRONG ──
--
-- The obvious version of this is two column revokes:
--
--   revoke update (moderated_by) on public.scholarships from anon, authenticated;
--   revoke update (removed_by)   on public.job_postings  from anon, authenticated;
--
-- The second line works. The first is a NO-OP, and it took a test to notice.
-- Measured against the CI project after applying exactly that:
--
--   has_table_privilege ('authenticated','scholarships','update')                -> TRUE
--   has_column_privilege('authenticated','scholarships','moderated_by','update') -> TRUE   <-- still writable
--   has_table_privilege ('authenticated','job_postings','update')                -> false
--   has_column_privilege('authenticated','job_postings','removed_by','update')   -> false
--
-- A TABLE-LEVEL GRANT OVERRIDES A COLUMN-LEVEL REVOKE. Supabase grants
-- ALL ON ALL TABLES to `authenticated`, and `job_postings` has had its table
-- grant taken away by earlier work while `scholarships` has not — so the same
-- two lines produced two different outcomes, and only one of them was the
-- intended one. This is the exact trap CLAUDE.md names and that 0028 and 0030
-- both had to solve; writing it down did not stop it happening again.
--
-- What made `scholarships.moderated_by` look safe is that no UPDATE POLICY
-- exists for `authenticated`, so an attempt affects zero rows and returns no
-- error. That is a policy protecting it, not a grant — one permissive policy
-- away from a seeker being able to sign someone else's name to a moderation
-- decision.
--
-- So: take the table grant off first, in the 0030 order. Nothing grants it
-- back, because nothing user-facing updates this table — every write goes
-- through the service role (ingest, the admin actions, the cost probe), and
-- the two files that touch `scholarships` with a user client only SELECT.

revoke update on public.scholarships from anon, authenticated;
revoke update (removed_by) on public.job_postings from anon, authenticated;

-- Answering "what has this operator decided" without a seq scan, which is the
-- first question anyone asks of an audit column.
create index scholarships_moderated_by_idx
  on public.scholarships (moderated_by) where moderated_by is not null;
create index job_postings_removed_by_idx
  on public.job_postings (removed_by) where removed_by is not null;
