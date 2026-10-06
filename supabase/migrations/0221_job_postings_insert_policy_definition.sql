-- 0221: job_postings INSERT policy definition, aligned with production's (#683).
--
-- WHAT. "org members can manage their org's internal postings" is the INSERT policy an employer's own session passes when posting a job. The repo's version (written in 0114) and
-- production's differ by one condition in the WITH CHECK: production's ledger entry 0128_claimable_job_postings changed the definition and has no counterpart in the repo (the repo's
-- 0128_claim_your_listing does not touch it). A database built from the repo (CI's per-job stack, the talentrah-preview project) therefore carries the older definition.
--
-- EFFECT. This sets the policy's WITH CHECK to production's definition. No-op on production (the expression is identical); on databases built from the repo it adds the one differing
-- condition. Idempotent: ALTER POLICY with the same expression changes nothing the second time. The policy's command (INSERT), roles (authenticated) and name are unchanged.
--
-- NOT HERE. The repo's 0128 file is not edited; this migration is the fix. Any other difference between production and a repo-built database is a separate decision.

alter policy "org members can manage their org's internal postings" on public.job_postings
  with check (
    source_type = 'internal'::public.job_source_type
    and public.is_org_member(organization_id)
    and unlisted_at is null
    and removed_at is null
    and removal_reason is null
    and removed_by is null
    and admin_review_decision is null
    and admin_reviewed_at is null
    and admin_reviewed_by is null
    and banner_path is null
    and claimed_by_organization_id is null
    and claimed_at is null
  );

-- Self-check: the migration fails (and rolls back) unless the policy's stored expression, with whitespace and schema qualifiers ignored, equals production's.
do $$
declare
  v_cmd text;
  v_roles text;
  v_check text;
  v_expected text := '((source_type = ''internal''::job_source_type) AND is_org_member(organization_id) AND (unlisted_at IS NULL) AND (removed_at IS NULL) AND (removal_reason IS NULL) AND (removed_by IS NULL) AND (admin_review_decision IS NULL) AND (admin_reviewed_at IS NULL) AND (admin_reviewed_by IS NULL) AND (banner_path IS NULL) AND (claimed_by_organization_id IS NULL) AND (claimed_at IS NULL))';
begin
  select cmd, array_to_string(roles, ','), with_check into v_cmd, v_roles, v_check
    from pg_policies
   where schemaname = 'public' and tablename = 'job_postings' and policyname = 'org members can manage their org''s internal postings';
  if v_cmd is null then
    raise exception 'self-check: the policy is missing';
  end if;
  if v_cmd <> 'INSERT' or v_roles <> 'authenticated' then
    raise exception 'self-check: the policy is no longer INSERT for authenticated (%, %)', v_cmd, v_roles;
  end if;
  if regexp_replace(replace(coalesce(v_check, ''), 'public.', ''), '\s+', '', 'g') <> regexp_replace(replace(v_expected, 'public.', ''), '\s+', '', 'g') then
    raise exception 'self-check: the policy expression is not production''s: %', v_check;
  end if;
end $$;
