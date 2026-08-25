-- 0026 — Organisation membership RLS: two real defects, found by probing the
-- live policies rather than reading them.
--
-- (A) PRIVILEGE GAP, live today. The INSERT policy on organization_members
--     checked only `user_id = auth.uid()` — it never asked whether the caller
--     had any relationship to the organisation. `role` is caller-supplied, so
--     ANY authenticated user could POST themselves into ANY existing org as
--     `owner` through the public anon API, with no app surface involved.
--     Verified empirically against the live project: HTTP 201, row created,
--     row removed afterwards.
--
-- (B) BROKEN POLICY, live today. The SELECT policy on organization_members
--     contained `EXISTS (SELECT 1 FROM organization_members m ...)` — a
--     self-reference, which Postgres rejects at query time with "infinite
--     recursion detected in policy". So every membership read errors out, and
--     so does every OTHER policy that resolves membership through a subquery
--     against this table: organizations UPDATE, job_postings INSERT/UPDATE.
--     Also verified empirically, not inferred.
--
-- The two interact, and that is the part worth stating plainly: (B) is
-- currently the only thing stopping (A) from escalating. A gate-crashing
-- "owner" cannot yet edit the organisation or its job postings — not because
-- the rules forbid it, but because those rules crash before they can allow it.
-- Whoever builds M8 must fix the recursion on day one, and fixing it alone
-- would have switched the escalation on. Fixing both together is the only
-- safe order.
--
-- Neither defect is reachable through any shipped screen (M8, the employer
-- side, has no product surface). Both are reachable directly through the
-- anon-key REST API by any signed-in user, which is the whole reason RLS is
-- the boundary that matters here.

-- Non-recursive membership predicate. SECURITY DEFINER so it reads the table
-- with RLS bypassed — that is what breaks the self-reference cycle. It answers
-- only about the CALLER's own membership, so it discloses nothing they could
-- not already ask about themselves. Follows 0016/0017's convention: pinned
-- search_path, execute revoked from the world and granted deliberately.
-- `authenticated` is required here, unlike those functions, because RLS
-- policies execute as the calling role.
create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;

-- (B) — same intent as before, expressed without the self-reference.
drop policy if exists "members can see their own membership rows" on public.organization_members;
create policy "members can see their own membership rows"
  on public.organization_members
  for select
  using (
    user_id = (select auth.uid())
    or public.is_org_member(organization_id)
  );

-- (A) — self-insert is still self-insert, but only into an organisation the
-- caller created. That is the only legitimate path that exists in Phase 1:
-- organisations are created with created_by = auth.uid(), and there is no
-- invitation flow yet (M8, not started). When invitations ship, widen this
-- deliberately — do not drop the organisation check.
drop policy if exists "a user can add themselves as an org member" on public.organization_members;
create policy "a user can join an organisation they created"
  on public.organization_members
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.organizations o
      where o.id = organization_id
        and o.created_by = (select auth.uid())
    )
  );

-- Policies that resolved membership through a subquery on organization_members
-- inherited (B)'s recursion and could never evaluate. Same rules, routed
-- through the helper so they actually run. job_postings gains a WITH CHECK on
-- UPDATE that it did not have: without one, a member could previously have
-- moved a posting to an organisation they do not belong to.
drop policy if exists "org members can update their organization" on public.organizations;
create policy "org members can update their organization"
  on public.organizations
  for update
  using (public.is_org_member(id))
  with check (public.is_org_member(id));

drop policy if exists "org members can manage their org's internal postings" on public.job_postings;
create policy "org members can manage their org's internal postings"
  on public.job_postings
  for insert
  to authenticated
  with check (
    source_type = 'internal'::job_source_type
    and public.is_org_member(organization_id)
  );

drop policy if exists "org members can update their org's internal postings" on public.job_postings;
create policy "org members can update their org's internal postings"
  on public.job_postings
  for update
  using (
    source_type = 'internal'::job_source_type
    and public.is_org_member(organization_id)
  )
  with check (
    source_type = 'internal'::job_source_type
    and public.is_org_member(organization_id)
  );
