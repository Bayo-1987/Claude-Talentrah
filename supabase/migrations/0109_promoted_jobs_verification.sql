-- 0109: a paid slot is a public listing, and must clear the same gate.
--
-- ── THE BUG, MEASURED ─────────────────────────────────────────────────────
--
-- `promoted_jobs` (0052, redefined 0095) is SECURITY DEFINER, so the
-- `job postings are publicly readable` policy never runs for it. Every other
-- listing surface leans on that policy to hide an unverified organisation's
-- postings (0027). This one filtered `j.status = 'open'`, the campaign's own
-- state and the seeker's filters — and never asked whether the organisation
-- was verified.
--
-- Measured live before writing this, one statement, one user, one instant:
--
--     organic_rows_visible   0     <- 0027's gate holding
--     promoted_rows_visible  1     <- the same posting, served as an ad
--
-- So the moderation gate held on the free surface and failed on the paid one.
-- That is the wrong way round: an ad carries more implied endorsement than an
-- organic card, not less.
--
-- ── WHY IT IS REACHABLE, WHICH WAS NOT OBVIOUS ────────────────────────────
--
-- Reaching a seeker needs a `match_scores` row for THAT seeker, and scores are
-- only written for postings the seeker could already read. That looks like it
-- closes the hole on its own. It does not, because verification is not
-- one-way: `saveCompanyProfileAction` re-runs it "in BOTH directions" when the
-- domain changes (src/lib/employer/actions.ts) — deliberately, so an employer
-- cannot verify with their real domain and then rename to someone else's while
-- keeping the badge. The scores written while the organisation was verified
-- outlive the verification:
--
--   1. org verifies, posts, runs an approved campaign
--   2. seekers see the posting organically; match_scores rows are written
--   3. org changes its domain -> `verified` flips back to false
--   4. the posting leaves the feed, search and sitemap — and keeps running as
--      a promoted card for everyone who already has a score
--
-- Step 3 is the same move 0028 and that comment defend against. The badge is
-- correctly revoked; the advertisement was not.
--
-- ── REVIEW IS NOT THE GATE, AND IS NOT MEANT TO BE ────────────────────────
--
-- Checked rather than assumed, because if approval already required
-- verification there would be nothing to fix here. It does not.
-- `set_ad_campaign_review` has no verification condition, and the admin queue
-- screen SHOWS the organisation's verified state next to its name with the
-- comment "an unverified organisation running paid ads is worth a second
-- look". That is advisory, for a human — a prompt to judge, not a rule. This
-- migration adds the rule, and leaves the prompt doing what it is good at.
--
-- ── WHY ONE PREDICATE, AND NOT ALSO AN `unlisted_at` ONE ──────────────────
--
-- The audit that found this was looking for somewhere the private-link work
-- (#273) might leak, and the honest answer is that it does reach here: a
-- signed-in candidate who opens an unlisted link has a match_scores row
-- written for them by /jobs/[id], so a "never listed" posting could be served
-- back to them as a sponsored card.
--
-- But that path needs no predicate of its own. An unlisted posting belongs to
-- an UNVERIFIED organisation — that is the entire premise of the feature — so
-- `verified` already excludes it. The one case where a stamped row survives
-- this filter is an organisation that minted a link and verified afterwards,
-- and that posting is fully public anyway, so promoting it is correct.
--
-- Adding `unlisted_at is null` as well would therefore be a second rule
-- expressing the same fact, load-bearing for nothing, and it would tie this
-- migration to a column that does not exist until #273 merges. One predicate,
-- no cross-branch dependency.
--
-- ── NO is_org_member EXCEPTION, DELIBERATELY ──────────────────────────────
--
-- The RLS policy grants members sight of their own unverified postings so an
-- employer does not lose track of their own drafts. That reason does not
-- transfer: these are the feed's paid slots, and there is nothing an employer
-- needs from seeing their own advert in their own seeker feed. The narrower
-- rule is the right one, and it means an unverified org's campaign reaches
-- nobody at all rather than reaching exactly its own staff.

create or replace function public.promoted_jobs(
  p_min_score integer default 60,
  p_work_types public.work_type[] default null,
  p_seniorities public.seniority_level[] default null,
  p_limit integer default 2
)
returns table (job_posting_id uuid, campaign_id uuid, match_score integer)
language sql
stable
security definer
set search_path = public
as $$
  select j.id, c.id, ms.score
    from public.ad_campaigns c
    join public.job_postings j
      on j.id = c.job_posting_id
     and j.status = 'open'
    join public.match_scores ms
      on ms.job_posting_id = j.id
     and ms.user_id = (select auth.uid())
   where (select auth.uid()) is not null
     and c.status = 'active'
     and (c.ends_on is null or current_date <= c.ends_on)
     -- NEW (0109). Mirrors the RLS policy's own verification branch rather
     -- than restating the rule: a paid slot clears the same gate as an
     -- organic one.
     --
     -- Anchored on the POSTING's organisation (`j.organization_id`), not the
     -- campaign's. They are the same for every campaign anyone should be able
     -- to create — but nothing enforces that: `ad_campaigns` carries four
     -- check constraints and none of them ties `job_posting_id` to
     -- `organization_id`, and the INSERT policy only checks membership of the
     -- campaign's own org. So a campaign CAN name a posting its org does not
     -- own (see the note filed alongside this migration). The posting's org is
     -- the correct anchor regardless, because it is the posting that gets
     -- listed and the posting's org whose verification the reader is being
     -- asked to trust.
     --
     -- An external posting has a NULL organisation by check constraint, so it
     -- fails this EXISTS. That is a real behaviour change for a campaign
     -- pointing at an external posting — but such a campaign advertises a job
     -- this platform does not host and cannot vouch for, so it should not have
     -- been running. None exist today; that was checked, over a population too
     -- small to mean anything, which is why the reasoning above does not rest
     -- on it.
     and exists (
       select 1 from public.organizations o
        where o.id = j.organization_id
          and o.verified
     )
     -- D1: the seeker's own filters and threshold bind a paid slot exactly as
     -- they bind an organic one. A null array means "no filter applied" —
     -- the feed passes null, not an empty array, when a dimension is unset.
     and ms.score >= p_min_score
     and (p_work_types is null or j.work_type = any (p_work_types))
     and (p_seniorities is null or j.seniority = any (p_seniorities))
     -- The employer's targeting, unchanged.
     and (c.target_locations is null or j.location = any (c.target_locations))
     and (c.target_seniority is null or j.seniority = any (c.target_seniority))
     and (c.target_employment_type is null or j.employment_type = any (c.target_employment_type))
   order by ms.score desc, c.created_at asc
   limit greatest(p_limit, 0);
$$;

-- `create or replace` preserves privileges, so 0095's grants stand. Asserted
-- rather than re-stated: re-asserting a grant list is what silently dropped
-- 0085's salary columns during another migration's first draft.
do $$
begin
  if has_function_privilege(
       'anon',
       'public.promoted_jobs(integer, public.work_type[], public.seniority_level[], integer)',
       'execute'
     ) then
    raise exception
      'promoted_jobs is executable by anon; 0095 revoked it, and it reads a per-user match_scores cache.';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.promoted_jobs(integer, public.work_type[], public.seniority_level[], integer)',
       'execute'
     ) then
    raise exception
      'promoted_jobs lost its authenticated EXECUTE grant; the feed would render no sponsored slots at all.';
  end if;
end $$;
