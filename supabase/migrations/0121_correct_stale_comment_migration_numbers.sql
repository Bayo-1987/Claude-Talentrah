-- 0121: correct two stale migration-number references baked into
-- `job_postings`' own column comments by 0119.
--
-- ── WHY A MIGRATION AND NOT A FILE EDIT ───────────────────────────────────
--
-- These two references live inside `comment on column` statements in
-- 0119_job_posting_admin_review.sql, so they are not source comments: they
-- ran, and the wrong text is sitting in production's and CI's `pg_catalog`
-- right now. 0119 has already applied to both databases, so editing that
-- file changes nothing about what is live — same reasoning the
-- "extend, don't re-declare" work applies to policies, pointed at catalog
-- text instead. The correction has to be its own forward migration.
--
-- ── WHY THESE TWO ARE WORTH CORRECTING AT ALL ─────────────────────────────
--
-- Both numbers are stale from the 0117 collision renumber, and neither is a
-- dangling pointer — each now names a real, live, UNRELATED migration, which
-- is strictly worse than pointing at nothing:
--
--   `0113` in admin_review_decision's comment meant the employer_verification
--          permission, which is now 0116. 0113 today is
--          `storage_usage_reader` — a real migration about Storage egress.
--   `0114` in admin_reviewed_by's comment meant `cac_confirmed_by`'s home,
--          which is now 0120_employer_cac_verification. 0114 today is
--          `organization_and_posting_insert_hardening` — real, and the one
--          0119's *other*, CORRECT 0114 references point at. So this file
--          currently uses "0114" to mean two different migrations.
--
-- The text is otherwise reproduced verbatim from 0119; only the two numbers
-- change. `comment on column` is idempotent and touches nothing but the
-- catalog entry — no data, no policy, no grant.

comment on column public.job_postings.admin_review_decision is
  '''approved'' or ''rejected'' — an admin''s Path 3 decision on THIS posting only (0116''s employer_verification does not apply here; this is job_review, 0118). Approving does not touch organizations.verified: every other and future posting from the same org needs its own separate approval. Service-role write only.';

comment on column public.job_postings.admin_reviewed_by is
  'The admin (profiles.id) who decided. References profiles, not admin_users, matching moderated_by/reviewed_by/removed_by (0064) and cac_confirmed_by (0120): a revoked admin account still resolves as a named person in the trail. Service-role write only.';

-- Reads the stored catalog text back, rather than trusting that the two
-- statements above ran — the same shape as 0119's and 0120's own self-checks.
-- Asserted POSITIVELY (the corrected number is present) and NEGATIVELY (the
-- stale one is gone), because either check alone passes on a partial fix.
do $$
declare
  decision_comment text;
  reviewer_comment text;
begin
  select col_description(a.attrelid, a.attnum) into decision_comment
  from pg_attribute a
  where a.attrelid = 'public.job_postings'::regclass
    and a.attname = 'admin_review_decision';

  select col_description(a.attrelid, a.attnum) into reviewer_comment
  from pg_attribute a
  where a.attrelid = 'public.job_postings'::regclass
    and a.attname = 'admin_reviewed_by';

  if decision_comment is null or reviewer_comment is null then
    raise exception
      'a job_postings admin-review column comment is missing entirely; 0119 should have set both.';
  end if;

  if decision_comment not like '%0116''s employer_verification%' then
    raise exception
      'admin_review_decision''s comment does not name 0116 as employer_verification''s migration.';
  end if;

  if decision_comment like '%0113%' then
    raise exception
      'admin_review_decision''s comment still references 0113, which is storage_usage_reader, not employer_verification.';
  end if;

  if reviewer_comment not like '%cac_confirmed_by (0120)%' then
    raise exception
      'admin_reviewed_by''s comment does not name 0120 as cac_confirmed_by''s migration.';
  end if;

  if reviewer_comment like '%(0114)%' then
    raise exception
      'admin_reviewed_by''s comment still references 0114, which is organization_and_posting_insert_hardening, not the CAC migration.';
  end if;
end $$;
