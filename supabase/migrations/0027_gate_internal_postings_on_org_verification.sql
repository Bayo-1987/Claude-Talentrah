-- 0027 — Close the second route to "publish jobs as a company you don't own".
--
-- Applied to the project 2026-08-25.
--
-- 0026 fixed the organization_members INSERT policy. It did not close the
-- class. Found by asking what else grants the same effective privilege, and
-- reproduced end-to-end against the live project with a throwaway user:
--
--   1. create an organisation named "Paystack"            -> 201, verified=false
--   2. join it as owner (legitimate — you created it)     -> 201
--   3. insert an internal job_posting under it            -> 201
--   4. read it back as a DIFFERENT signed-in user, using
--      the feed's own query (src/app/(app)/jobs/page.tsx) -> 1 row, company "Paystack"
--
-- Every step is allowed by design. No policy is bypassed. The gap is that
-- nothing anywhere gates a posting on whether its organisation was ever
-- verified: `organizations.verified` exists, defaults to false, and is read by
-- nothing. So any signed-in user can put a job — a phishing lure, in the
-- reproduction above — into every other user's feed under a real company's
-- name.
--
-- Worth being blunt about the sequencing: 0026 is what made this reachable.
-- Before it, steps 2 and 3 died on the recursion bug. The recursion fix was
-- correct and necessary, and it removed the accident that was standing in for
-- a rule that had never been written. This is that rule.
--
-- Fix at the RLS layer, not in the feed query. The feed is one of several
-- readers (tailor page, cost probe, any future surface), and the same shape is
-- already established for scholarships — "only verified scholarships are
-- publicly readable". One boundary, enforced for every reader.
--
-- Not touched here, deliberately: `organizations` INSERT stays open, because
-- the payoff is gone once unverified postings are invisible, and M8 will
-- define the real onboarding flow. The org row itself stays publicly readable;
-- no surface renders unverified orgs, so an invented name is inert.

-- An unverified organisation's postings are visible to its own members (so an
-- employer can see their draft) and to nobody else. External postings — the
-- aggregated feed, which has no organisation — are unaffected.
drop policy if exists "job postings are publicly readable" on public.job_postings;
create policy "job postings are publicly readable"
  on public.job_postings
  for select
  using (
    source_type = 'external'::job_source_type
    or exists (
      select 1 from public.organizations o
      where o.id = job_postings.organization_id
        and o.verified
    )
    or public.is_org_member(organization_id)
  );

-- Housekeeping from the 0000 baseline review: 0026 intended is_org_member to
-- be authenticated-only, but Supabase's ALTER DEFAULT PRIVILEGES had already
-- granted EXECUTE to anon at creation, and REVOKE ... FROM public does not
-- remove a role-specific grant. Harmless today — auth.uid() is null for anon,
-- so it can only return false — but the grant should match the intent.
revoke execute on function public.is_org_member(uuid) from anon;
