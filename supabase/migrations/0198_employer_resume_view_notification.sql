-- 0198 — send-464: tell the seeker THE MOMENT an employer views their resume,
-- not just show a passive Job Tracker badge for it.
--
-- 0126 already stamps `employer_applicant_status.first_viewed_at` (set once,
-- via `record_employer_resume_view`) and lets the seeker's own Job Tracker
-- read it back through `seeker_application_view_status`. Both of those stay
-- completely unchanged here — this migration does not touch
-- `seeker_application_view_status` at all, and does not touch the
-- ON CONFLICT / coalesce "set once" shape that makes first_viewed_at a
-- one-time stamp.
--
-- What's missing is a live notification: nothing in 0126 tells the CALLER of
-- `record_employer_resume_view` whether its own call was the one that just
-- set the stamp for the first time, so `src/app/employer/jobs/[id]/
-- applicants/[applicationId]/resume/page.tsx` (the one real call site — the
-- only place in the app that calls this RPC, confirmed by grep before writing
-- this) had no way to fire a one-time notification without either a second
-- round trip (a read-then-write race — CLAUDE.md's own standing lesson on why
-- that is not a gate) or restructuring the function's write itself.
--
-- ── 1. record_employer_resume_view: same signature, same INSERT/ON CONFLICT
--    body, additive RETURNS change only ──────────────────────────────────
--
-- CREATE OR REPLACE cannot change a function's return type, so this drops and
-- recreates it (re-issuing the same revoke/grant afterwards, since DROP
-- removes them). The core write is byte-for-byte the same INSERT ... SELECT
-- ... WHERE <membership check> ... ON CONFLICT ... coalesce(existing, new)
-- 0126 already had — wrapped in two CTEs so the function can report what
-- happened, not to change what happens:
--
--   `existing`  — the row's state as of the START of this statement (a CTE
--                 without a data-modifying counterpart sees the pre-statement
--                 snapshot, before the INSERT/UPDATE below has run). Either
--                 no row yet, or a row already carrying a non-null
--                 first_viewed_at (set once, by an earlier call).
--   `upserted`  — the exact same INSERT ... ON CONFLICT as before, with
--                 `returning 1` so the function can tell whether the
--                 membership-gated WHERE clause actually matched anything.
--
-- The function returns true iff BOTH: the upsert actually ran (the caller
-- passed the membership check — a non-member or unknown application id still
-- produces zero rows in `upserted`, so this returns false, matching 0126's
-- own "true no-op, not an error" contract exactly), AND `existing` had no
-- non-null first_viewed_at (there was no row yet, or a status-tracking row
-- existed with the stamp still unset) — i.e. this call is the one that just
-- transitioned first_viewed_at from unset to set. Any later call for the
-- same application returns false: `existing` already shows a non-null
-- timestamp by then, even though the row still gets touched (same as before).
drop function if exists public.record_employer_resume_view(uuid);

create function public.record_employer_resume_view(p_application_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with existing as (
    select first_viewed_at
    from public.employer_applicant_status
    where application_id = p_application_id
  ),
  upserted as (
    insert into public.employer_applicant_status (application_id, first_viewed_at)
    select p_application_id, now()
    where public.is_org_member_for_application(p_application_id)
    on conflict (application_id) do update
      set first_viewed_at = coalesce(
        public.employer_applicant_status.first_viewed_at,
        excluded.first_viewed_at
      )
    returning 1
  )
  select exists (select 1 from upserted)
     and not exists (select 1 from existing where first_viewed_at is not null);
$$;

revoke all on function public.record_employer_resume_view(uuid) from public;
revoke all on function public.record_employer_resume_view(uuid) from anon;
grant execute on function public.record_employer_resume_view(uuid) to authenticated, service_role;

comment on function public.record_employer_resume_view(uuid) is
  'Stamps employer_applicant_status.first_viewed_at the first time an employer opens ONE application''s resume, gated on org membership exactly like is_org_member_for_application (unchanged from 0126). Returns TRUE iff THIS call was the one that just set the stamp for the first time (send-464 — lets the caller trigger a one-time seeker notification without a second, racy read). Returns FALSE for a non-member caller or unknown application id (a true no-op, same as before) and for every call after the first for a given application.';

-- ── 2. employer_resume_view_context — the job/seeker facts the notification
--    needs, gated the SAME way as employer_view_resume (0125) ──────────────
--
-- `applications` is owner-only RLS (`auth.uid() = user_id`, 0000's baseline) —
-- an employer's own session cannot read it directly, which is exactly why
-- `employer_view_resume` and `employer_job_applicants` are both SECURITY
-- DEFINER with their own independent `is_org_member_for_application`/
-- `is_org_member` check rather than an inline EXISTS (0125's own header:
-- sabotage-tested, an inline EXISTS silently queries through the owner-only
-- wall it needs to see past). This is the same shape, for the one additional
-- fact this feature needs that `employer_view_resume` doesn't carry: the
-- seeker's own id (to notify) and the posting's title/company_name (to name
-- them in the notice). `job_postings.company_name` is already denormalized
-- onto the posting row (0000's baseline) — no organizations join needed.
create or replace function public.employer_resume_view_context(p_application_id uuid)
returns table (
  seeker_id uuid,
  job_title text,
  company_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.user_id, j.title, j.company_name
  from public.applications a
  join public.job_postings j on j.id = a.job_posting_id
  where a.id = p_application_id
    and public.is_org_member_for_application(p_application_id);
$$;

revoke all on function public.employer_resume_view_context(uuid) from public;
revoke all on function public.employer_resume_view_context(uuid) from anon;
grant execute on function public.employer_resume_view_context(uuid) to authenticated, service_role;

comment on function public.employer_resume_view_context(uuid) is
  'The seeker id, job title and company name for ONE application''s resume-view notification (send-464), gated on the exact same is_org_member_for_application check as employer_view_resume/record_employer_resume_view. Returns nothing for a non-member caller or unknown application id, same no-op contract as its siblings.';

-- ── 3. email_preferences.employer_resume_view — the per-person opt-out ─────
--
-- Same shape as 0131's own proactive_match_alert column: a dedicated boolean,
-- not a reused one, because CLAUDE.md's own "three switches, not one" rule
-- (digest/send.ts's header) applies here too — this is a distinct kind of
-- mail from the digest and from the proactive match alert, so it needs its
-- own opt-out rather than silently riding one of theirs. Defaults true and
-- has no companion feature_flags row: this is a transactional, factual
-- notice about something the employer just did to THIS seeker's own
-- application (§6.10's "transactional: immediate: status change" bucket),
-- not a recurring, batched, opt-in-by-product-decision send like the digest.
alter table public.email_preferences
  add column employer_resume_view boolean not null default true;

comment on column public.email_preferences.employer_resume_view is
  'Whether THIS PERSON wants the "an employer viewed your resume" email (send-464). Fires at most once per application — see record_employer_resume_view''s own comment. Separate from job_match_digest/proactive_match_alert on purpose, same reasoning as those two columns'' own comments.';
