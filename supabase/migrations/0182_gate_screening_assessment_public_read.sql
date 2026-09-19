-- 0182 — close a public-read RLS gap on job_posting_screening_questions
-- (0171), job_posting_assessments (0177), and job_posting_assessment_files
-- (0178): all three shipped with a bare `for select using (true)`, `roles:
-- {public}` policy, each justified in its own migration comment as "same
-- shape as job_postings' own policy" — but none of them actually joined
-- back to job_postings to check it. job_postings' own SELECT policy has
-- grown two more branches since 0056 (0107's unlisted links, 0119's admin
-- review), and every one of these three tables was written and left behind
-- as that policy moved, so "same shape" was true only at each one's own
-- creation time and silently stopped being true afterward.
--
-- ── THE HOLE, CONCRETELY ────────────────────────────────────────────────────
--
-- A removed posting, or a posting whose organisation is not (or no longer)
-- verified, is NOT visible via job_postings' own policy unless it also
-- happens to be unlisted-linked, admin-approved, or belongs to the caller's
-- own org. But its screening questions / assessment / assessment files were
-- readable by anyone, signed in or not, regardless. Confirmed via direct
-- production query (pg_policies) before writing this migration, and
-- confirmed zero rows are exposed TODAY (the one removed posting and two
-- unverified-org postings currently in production have no screening/
-- assessment content attached) — a real structural hole, not an active
-- leak of specific data yet.
--
-- ── THE FIX: JOIN BACK, DO NOT REIMPLEMENT ──────────────────────────────────
--
-- Each policy below is `exists (select 1 from public.job_postings j where
-- j.id = <this row's posting id> and <job_postings' own live qual, copied
-- verbatim and applied to j>)`. Re-pulled from `pg_policies` on
-- nytwbbzfpytctjsoczzq immediately before writing this migration (not from
-- 0056's original text, which is exactly the mistake being fixed):
--
--   (source_type = 'external' AND status <> 'removed')
--   OR (EXISTS (SELECT 1 FROM organizations o WHERE o.id = job_postings.organization_id AND o.verified) AND status <> 'removed')
--   OR (unlisted_at IS NOT NULL AND status <> 'removed')
--   OR (admin_review_decision = 'approved' AND status <> 'removed')
--   OR is_org_member(organization_id)
--
-- is_org_member() is reused exactly as job_postings' own policy uses it —
-- not reimplemented — and needs no new EXECUTE grant here: it is already
-- SECURITY DEFINER with EXECUTE granted to both anon and authenticated
-- (confirmed directly, not assumed), the same two roles `roles: {public}`
-- below evaluates as.
--
-- job_posting_assessment_files has no direct job_posting_id column, so its
-- version joins job_posting_assessments -> job_postings first. It
-- deliberately does NOT use its own denormalized `organization_id` column
-- for this — that column exists for the WRITE-side policy only (see 0178's
-- own comment) and covers just the is_org_member branch, not the other four
-- public-visibility branches job_postings' policy actually has.
--
-- THIS DUPLICATION IS THE THING THAT ALREADY DRIFTED THREE TIMES. If
-- job_postings' own SELECT policy changes again, these three policies (grep
-- for "0182" or "job_postings' own live qual") need to change with it in the
-- same migration — that discipline, not a shared helper function, is what
-- this fix asks for; introducing a new abstraction here was deliberately
-- left out as more surface than this scoped fix needs.
--
-- ── WHAT IS NOT CHANGING ─────────────────────────────────────────────────
--
-- Only these three SELECT policies. The existing "org members can manage
-- their own postings'/assessment's ..." ALL policies on all three tables
-- already correctly scope to is_org_member and are untouched — an org
-- member keeps full read/write access to their own posting's screening
-- questions, assessment, and assessment files regardless of the posting's
-- own status or the org's verification state, exactly as before.
-- job_postings' own policy is the reference here, not the target, and is
-- also untouched.
--
-- Also untouched, and deliberately: application_screening_answers (0171)
-- and application_assessment_submissions (0177) already scope their own
-- SELECT policies to the applying user or the owning org — neither has a
-- bare `using (true)` and neither is part of this bug pattern. Checked
-- directly (not assumed) against every `roles: {public}, cmd: SELECT, qual:
-- true` policy in this schema before writing this migration: the only
-- other five are course_recommendations, credit_packs, organizations,
-- passes, and resume_templates — none of them has a foreign key into a
-- more-restricted parent table the way these three do; they are genuinely
-- standalone public catalog/reference data (or, for organizations, the
-- top-level entity itself — a company's public profile is deliberately
-- readable regardless of its verification state, only its POSTINGS are
-- gated on that, per CLAUDE.md's own documented model). job_posting_reports
-- was also checked and has no SELECT/ALL policy at all (default-deny), so
-- it is not part of this pattern either. This is the full set — no fourth
-- instance found.

drop policy "screening questions are publicly readable" on public.job_posting_screening_questions;

create policy "screening questions are publicly readable" on public.job_posting_screening_questions
  for select
  using (
    exists (
      select 1 from public.job_postings j
      where j.id = job_posting_screening_questions.job_posting_id
        and (
          (j.source_type = 'external'::job_source_type and j.status <> 'removed'::job_status)
          or (
            exists (select 1 from public.organizations o where o.id = j.organization_id and o.verified)
            and j.status <> 'removed'::job_status
          )
          or (j.unlisted_at is not null and j.status <> 'removed'::job_status)
          or (j.admin_review_decision = 'approved'::text and j.status <> 'removed'::job_status)
          or public.is_org_member(j.organization_id)
        )
    )
  );

drop policy "job posting assessments are publicly readable" on public.job_posting_assessments;

create policy "job posting assessments are publicly readable" on public.job_posting_assessments
  for select
  using (
    exists (
      select 1 from public.job_postings j
      where j.id = job_posting_assessments.job_posting_id
        and (
          (j.source_type = 'external'::job_source_type and j.status <> 'removed'::job_status)
          or (
            exists (select 1 from public.organizations o where o.id = j.organization_id and o.verified)
            and j.status <> 'removed'::job_status
          )
          or (j.unlisted_at is not null and j.status <> 'removed'::job_status)
          or (j.admin_review_decision = 'approved'::text and j.status <> 'removed'::job_status)
          or public.is_org_member(j.organization_id)
        )
    )
  );

-- job_posting_assessment_files.enforce_max_assessment_files() (0178) counts
-- sibling rows under the CALLER's own role, relying on this SELECT policy
-- to succeed for a legitimate org-member insert — checked, not assumed:
-- the inserting user is always an org member of the posting's own org (the
-- ALL policy on this table requires it), and is_org_member(...) is one of
-- the branches below, so the trigger's count query still succeeds for
-- every legitimate insert after this change.
drop policy "job posting assessment files are publicly readable" on public.job_posting_assessment_files;

create policy "job posting assessment files are publicly readable" on public.job_posting_assessment_files
  for select
  using (
    exists (
      select 1
      from public.job_posting_assessments a
      join public.job_postings j on j.id = a.job_posting_id
      where a.id = job_posting_assessment_files.job_posting_assessment_id
        and (
          (j.source_type = 'external'::job_source_type and j.status <> 'removed'::job_status)
          or (
            exists (select 1 from public.organizations o where o.id = j.organization_id and o.verified)
            and j.status <> 'removed'::job_status
          )
          or (j.unlisted_at is not null and j.status <> 'removed'::job_status)
          or (j.admin_review_decision = 'approved'::text and j.status <> 'removed'::job_status)
          or public.is_org_member(j.organization_id)
        )
    )
  );
