-- 0190 — a `draft` posting is invisible to everyone except its own org,
-- and editable by its own org while it stays a draft. send-447.
--
-- ── THE SELECT POLICY: THE SAME EXCLUSION 'removed' ALREADY GETS ─────────
--
-- Current text confirmed live before writing this (0119's own definition,
-- unmodified since): five OR-branches. Four of them repeat their own
-- `status <> 'removed'::job_status` independently rather than inheriting one
-- from an outer AND — 0107's own header explains why: a branch that quietly
-- omitted it would readmit a removed posting through that one route. This
-- adds `status <> 'draft'::job_status` to those same four branches, in the
-- same independent shape, for the same reason.
--
-- `is_org_member(organization_id)` — the fifth branch — stays completely
-- unconditional, exactly as it already is for 'removed': an org must always
-- be able to see its own posting, draft or otherwise, or "where did my job
-- go?" has no answer. There is nothing to add here.
drop policy "job postings are publicly readable" on public.job_postings;

create policy "job postings are publicly readable"
  on public.job_postings
  for select
  using (
    (source_type = 'external'::job_source_type
      and status <> 'removed'::job_status and status <> 'draft'::job_status)
    or (
      exists (
        select 1 from public.organizations o
        where o.id = job_postings.organization_id and o.verified
      )
      and status <> 'removed'::job_status and status <> 'draft'::job_status
    )
    or (unlisted_at is not null
      and status <> 'removed'::job_status and status <> 'draft'::job_status)
    or (admin_review_decision = 'approved'::text
      and status <> 'removed'::job_status and status <> 'draft'::job_status)
    or is_org_member(organization_id)
  );

-- Asserts all four branches actually carry the new exclusion in the STORED
-- policy, not just in this file's copy of it — the same shape as 0119's own
-- self-check, but counting occurrences rather than checking presence once:
-- a policy that mentions 'draft' only in one branch would pass a bare
-- `ilike '%draft%'` check just as easily as one that got all four right.
do $$
declare
  policy_text text;
  draft_mentions integer;
begin
  select pg_get_expr(polqual, polrelid) into policy_text
  from pg_policy
  where polrelid = 'public.job_postings'::regclass
    and polname = 'job postings are publicly readable';

  if policy_text is null then
    raise exception 'the job_postings SELECT policy is missing after this migration''s own rewrite.';
  end if;

  select count(*) into draft_mentions
  from regexp_matches(policy_text, 'draft', 'gi');

  if draft_mentions < 4 then
    raise exception
      'the job_postings SELECT policy mentions ''draft'' % time(s), expected at least 4 (one per external/verified-org/unlisted/admin-approved branch) — a draft exclusion was lost from at least one branch.',
      draft_mentions;
  end if;
end $$;

-- ── THE UPDATE POLICY: A DRAFT MUST STAY A DRAFT ON AN UNRELATED EDIT ─────
--
-- Current text confirmed live before writing this (0056's own definition,
-- unmodified since):
--
--   using (source_type = 'internal' and is_org_member(organization_id)
--          and status <> 'removed')
--   with check (source_type = 'internal' and is_org_member(organization_id)
--          and status in ('open', 'closed'))
--
-- The USING clause is untouched: an org can already update a draft (draft is
-- not removed), which is exactly what editing one, or publishing one, needs.
--
-- The WITH CHECK clause is the real bug this migration fixes, found by
-- reading this policy rather than assuming it already handled a status it
-- was written before: `updateJobAction` (the plain "Save changes" edit) does
-- NOT include `status` in its own UPDATE payload, so an edit to a draft
-- leaves status untouched at 'draft' — and Postgres evaluates WITH CHECK
-- against the ROW AS IT WOULD BE AFTER the update, not against which columns
-- the statement named. 'draft' was not in the allowed list, so *every* edit
-- to an existing draft — even one that never mentions status — would have
-- been silently rejected by RLS the moment this enum value existed. Adding
-- 'draft' here is what makes "edit a draft, still a draft" possible at all;
-- 'open' already covers the actual publish transition (draft -> open).
drop policy "org members can update their org's internal postings" on public.job_postings;

create policy "org members can update their org's internal postings"
  on public.job_postings
  for update
  using (
    source_type = 'internal'::job_source_type
    and is_org_member(organization_id)
    and status <> 'removed'::job_status
  )
  with check (
    source_type = 'internal'::job_source_type
    and is_org_member(organization_id)
    and status in ('open'::job_status, 'closed'::job_status, 'draft'::job_status)
  );

do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.job_postings'::regclass
      and polname = 'org members can update their org''s internal postings'
      and pg_get_expr(polwithcheck, polrelid) ilike '%draft%'
  ) then
    raise exception
      'the job_postings UPDATE policy''s WITH CHECK does not mention draft — editing an existing draft without touching status would be silently rejected.';
  end if;
end $$;

-- ── posted_at STOPS BEING CLIENT-WRITABLE ─────────────────────────────────
--
-- Checked live before writing this, not assumed: `posted_at` was grantable
-- for UPDATE to BOTH `authenticated` and `anon` — a real, pre-existing gap,
-- not something already closed the way `closed_at` (0102) already is. Any
-- org member (any signed-in session at all, in fact — the `anon` grant is
-- broader than RLS alone would suggest) could PATCH their own posting's
-- `posted_at` directly today, which is exactly the freshness-gaming surface
-- this repo's own `freshnessFloorISO()` and "Most Recent" sort assume
-- nobody can reach.
--
-- Draft support makes this concrete rather than theoretical: publishing a
-- draft now needs `posted_at` stamped at the MOMENT it goes public (task
-- requirement, and the only way freshness-gated surfaces measure age from
-- visibility rather than from whenever the draft was quietly started), and
-- that stamp has to happen through a channel the org itself cannot also
-- reach directly — the same two-step shape `setJobStatusAction` already uses
-- for `closed_at`: the session client authorises the status change (RLS plus
-- the `status` column grant are the real gate), a separate service-role call
-- records the trust fact that change produced.
revoke update (posted_at) on public.job_postings from authenticated, anon;

do $$
begin
  if exists (
    select 1
    from information_schema.column_privileges cp
    where cp.table_schema = 'public'
      and cp.table_name = 'job_postings'
      and cp.column_name = 'posted_at'
      and cp.grantee in ('authenticated', 'anon')
      and cp.privilege_type = 'UPDATE'
  ) then
    raise exception
      'posted_at is still UPDATE-grantable by a client role after this migration''s revoke.';
  end if;
end $$;
