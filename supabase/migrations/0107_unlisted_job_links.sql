-- 0107: an unverified employer can mint ONE private link per job.
--
-- ── WHAT THIS OPENS, STATED FIRST ─────────────────────────────────────────
--
-- Before this, an internal posting was publicly readable only when its
-- organisation was `verified` (0027, re-stated in 0056's policy). This adds a
-- second route: a posting whose `unlisted_at` is set is readable by anyone
-- holding its id, whether or not the org is verified. That is a real widening
-- of public read, and it is the point — an employer waiting on verification
-- currently has nothing to hand a candidate.
--
-- ── WHY PER-POSTING AND NOT PER-ORG ───────────────────────────────────────
--
-- The obvious shape — "readable if the org is unverified but has confirmed
-- its email" — is the one that must not be built. It would expose EVERY
-- posting of EVERY unverified org the moment the condition held, which is
-- precisely the moderation gate 0027 exists to keep closed. Recording the
-- grant on the ROW means it only exists where the application deliberately
-- wrote it, once, through a path that checks a confirmed email and a rate
-- limit. The database enforces "this row was granted"; the application decides
-- what earns the grant.
--
-- ── WHY THIS COLUMN IS NOT WRITABLE BY ITS OWNER ──────────────────────────
--
-- `unlisted_at` is a trust column, the same shape as `removed_at`,
-- `removal_reason` (0056) and `closed_at` (0102): setting it grants public
-- reachability. 0056 revoked table-level UPDATE and re-granted a named column
-- list, so a column added afterwards is NOT writable by `authenticated` or
-- `anon` unless it is added to that list. It is deliberately not added.
--
-- An org that could set this could publish to the world without verification,
-- which would make the gate above decorative. Only the service role writes it.
-- tests/rls/column-privileges.test.ts carries the standing assertion.
--
-- ── THE `removed` EXCLUSION IS REPEATED, NOT INHERITED ────────────────────
--
-- Each branch of this policy carries its own `status <> 'removed'`. There is
-- no outer AND to inherit from, so a branch that omitted it would make removed
-- postings readable again through the new route — undoing an operator's
-- removal by a side door. `closed` is deliberately NOT excluded, matching
-- every other branch: /jobs/[id] renders a closed posting and says it is
-- closed, so a closed job's link is not dead.

alter table public.job_postings
  add column unlisted_at timestamptz;

comment on column public.job_postings.unlisted_at is
  'When a private share link was first minted for this posting. Non-null makes the row publicly readable by id even if the organisation is unverified — see 0107. Service-role write only: it is a trust column, like removed_at and closed_at.';

-- Minting is once per posting, so the lookup is by row; no index is added for
-- a column that is only ever read through a primary-key fetch or a policy
-- predicate already anchored on other indexed conditions.

drop policy "job postings are publicly readable" on public.job_postings;

create policy "job postings are publicly readable"
  on public.job_postings
  for select
  using (
    (source_type = 'external'::job_source_type and status <> 'removed'::job_status)
    or (
      exists (
        select 1 from public.organizations o
        where o.id = job_postings.organization_id and o.verified
      )
      and status <> 'removed'::job_status
    )
    -- NEW (0107). Its own `removed` exclusion, deliberately repeated.
    or (unlisted_at is not null and status <> 'removed'::job_status)
    or is_org_member(organization_id)
  );

-- NO revoke/re-grant here, and that is the correction this migration needed.
--
-- The first draft re-asserted 0056's grant list "as documentation", so that the
-- absence of `unlisted_at` from it would be visible in this file. That was
-- destructive: `revoke update ... ` followed by 0056's list SILENTLY DROPPED the
-- four salary columns 0085 added afterwards, and an employer could no longer
-- edit salary on their own posting. Caught by
-- tests/rls/column-privileges.test.ts's "can set and then update salary"
-- positive control, which failed with 42501.
--
-- A new column needs no grant statement at all: 0056 revoked table-level UPDATE
-- and re-granted per column, so anything added later is withheld by default.
-- The guard below asserts that rather than re-stating a list that goes stale
-- every time another migration adds a writable column.

-- Fails the migration if `unlisted_at` ever acquires an UPDATE grant for a
-- client role — the same guard shape 0056 used, narrowed to the one column
-- this migration is responsible for.
do $$
begin
  if exists (
    select 1
    from information_schema.column_privileges cp
    where cp.table_schema = 'public'
      and cp.table_name = 'job_postings'
      and cp.column_name = 'unlisted_at'
      and cp.grantee in ('authenticated', 'anon')
      and cp.privilege_type = 'UPDATE'
  ) then
    raise exception
      'unlisted_at is UPDATE-grantable by a client role. It grants public reachability; only the service role may set it.';
  end if;
end $$;
