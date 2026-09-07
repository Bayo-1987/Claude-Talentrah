-- 0110 — cut the free resume-template tier from 27 slugs down to 9, one per
-- "major" category, and leave the other 12 categories with zero free slots.
--
-- ── WHY, AND WHY THIS IS A CURATION CALL, NOT A DATA-DRIVEN ONE ───────────
--
-- Founder decision: 27 free / 38 premium (across 65 templates in 21
-- categories) is too generous a free tier to leave standing now that the
-- full PR3 library has shipped. `user_template_unlocks` is empty in both
-- Supabase projects — there is no usage signal to rank categories by, so
-- this migration is a defensible judgment call, documented here, not a
-- measurement. Revisit on real signal once `user_template_unlocks` has rows,
-- the same "cheapest-to-reverse default, revisit on real user signal" stance
-- CLAUDE.md already applies to the scholarship geographic-scope decision.
--
-- ── WHICH 9 CATEGORIES, AND WHY ────────────────────────────────────────────
--
-- Kept free (1 slug each), picked for the broadest job-seeker demand this
-- product's stated audience (Nigeria/Africa career platform, CLAUDE.md) is
-- likely to have, weighted toward sectors that are either the largest
-- formal-sector employers or the ones this product's own diaspora/hard-
-- currency thesis leans on:
--
--   Business                    clean-professional  (generalist default —
--                                serves any job seeker regardless of field;
--                                also the one template every other part of
--                                the app already treats as the fallback)
--   Administration               structured-admin    (largest single category
--                                of formal entry-level office roles)
--   Technology                   terminal            (fastest-growing sector,
--                                the segment this product's AI positioning
--                                most directly targets; see swap note below)
--   Banking & Finance             ledger              (one of Nigeria's
--                                largest formal employment sectors)
--   Sales & Marketing             funnel              (cross-cutting demand —
--                                nearly every industry hires for this)
--   Healthcare                    care-plan           (large, essential
--                                workforce; see swap note below)
--   Education & Academia          curriculum-vitae    (teaching/academic
--                                roles are a very large formal sector)
--   Engineering                   blueprint           (large formal sector;
--                                the umbrella category for the narrower
--                                Construction and Oil & Gas verticals that
--                                did NOT make the cut individually)
--   NGO & Development             field-mission       (a genuinely large,
--                                distinct career path for Nigerian/African
--                                job seekers — international development,
--                                UN/INGO employers — not just an adjunct of
--                                Business)
--
-- Left at zero free slugs (12 categories): Design, Customer Success, Legal,
-- Project Management, Government & Public Sector, Creative & Media,
-- Agriculture & Agribusiness, Oil & Gas / Energy, Telecommunications,
-- Construction & Real Estate, Hospitality & Travel, Logistics & Supply
-- Chain. Each is a real Nigerian/African sector, but narrower than the nine
-- above either in formal-sector headcount or in how distinct its resume
-- needs are from a generalist template (Business/Administration/Sales &
-- Marketing already serve an entry-level job seeker in most of these
-- fields adequately) — plausible calls to make differently later, not
-- claims that these sectors don't matter to the product.
--
-- ── TWO WITHIN-CATEGORY SWAPS, NOT JUST DROPS ─────────────────────────────
--
-- Structured Admin, Ledger, Funnel, Curriculum Vitae, Blueprint and Field
-- Mission were each already their category's ONLY free slug (or, for
-- Business, the slug every other surface already treats as the default) —
-- kept free unchanged, least disruptive.
--
-- Technology and Healthcare each had TWO free slugs, and in both cases the
-- one being dropped is the ATS-unsafe, more heavily styled one:
--   - Technology: `product-tech` (ats_safe = false — header-band skeleton,
--     0105's own header calls out this exact reclassification) is dropped;
--     `terminal` (ats_safe = true, plain compact-dense) becomes the sole
--     free slug instead of the previously-free `product-tech`. A free-tier
--     user is better served by the plainer, ATS-safe option.
--   - Healthcare: `clinical` (ats_safe = false, one of the six pre-PR2
--     bespoke components, never migrated onto the skeleton system) is
--     dropped; `care-plan` (ats_safe = true, single-column) becomes the
--     sole free slug instead.
-- Banking & Finance's two free slugs (`ledger`, `compliance-brief`) are both
-- ats_safe = true, so no ATS-safety tiebreaker applies there — kept the
-- original pre-PR3 free slug (`ledger`) as the least-disruptive choice.
-- Sales & Marketing's one free slug (`funnel`) is ats_safe = false, but so
-- is its only premium alternative (`pitch-deck`) — no ATS-safe option
-- exists in this category to swap to, so `funnel` stays free unchanged.
--
-- Net effect: every slug below moves FREE -> PREMIUM. No slug moves the
-- other direction — `terminal` and `care-plan` were already free before
-- this migration (their categories had two free slugs each), so keeping
-- them free is a no-op for those two rows; only the OTHER slug in each of
-- those two categories (`product-tech`, `clinical`) actually changes here.
--
-- 18 slugs flip free -> premium, at the standard 10-credit unlock cost
-- (confirmed against src/lib/billing/catalog.ts: every existing premium row
-- uses `unlock_cost_credits = 10`, no row uses any other value):
--
--   slug              category                     before -> after
--   business-memo     Business                      free    -> premium (10)
--   filing-system     Administration                free    -> premium (10)
--   product-tech      Technology                    free    -> premium (10)
--   studio-brief      Design                        free    -> premium (10)
--   field-notes       Customer Success               free    -> premium (10)
--   help-desk         Customer Success               free    -> premium (10)
--   compliance-brief  Banking & Finance               free    -> premium (10)
--   clinical          Healthcare                      free    -> premium (10)
--   chambers          Legal                           free    -> premium (10)
--   sprint-board      Project Management              free    -> premium (10)
--   civic-record      Government & Public Sector      free    -> premium (10)
--   byline            Creative & Media                free    -> premium (10)
--   harvest           Agriculture & Agribusiness      free    -> premium (10)
--   rig-report        Oil & Gas / Energy              free    -> premium (10)
--   network-ops       Telecommunications              free    -> premium (10)
--   site-plan         Construction & Real Estate      free    -> premium (10)
--   front-desk        Hospitality & Travel            free    -> premium (10)
--   manifest          Logistics & Supply Chain        free    -> premium (10)
--
-- Untouched (stay free): clean-professional, structured-admin, terminal,
-- ledger, funnel, care-plan, curriculum-vitae, blueprint, field-mission.
--
-- ── GRANDFATHERING, DELIBERATELY NOT HANDLED HERE ─────────────────────────
--
-- `is_premium`/`unlock_cost_credits` are checked at exactly two points —
-- `unlockTemplateAction` and `createResumeAction`
-- (src/lib/resume-builder/actions.ts) — both gates on CREATING something new
-- (spending credits to unlock a template, or starting a brand-new resume
-- from one). `saveResumeAction` takes no template reference at all, and
-- `/resume-builder/edit` reads only the joined template `slug` to pick a
-- renderer, never `is_premium`. So a user who already built a resume on one
-- of the 18 slugs below keeps editing and saving it freely after this
-- migration — nothing here retroactively locks existing work; only starting
-- a NEW resume on one of these slugs (or explicitly unlocking it) is gated
-- from this point on. Re-verified against the full repo, not assumed.
--
-- ── WHY UPDATE, NOT A SCHEMA CHANGE, AND WHY NO EXISTENCE CHECK ───────────
--
-- Same idiom as 0104/0106: plain per-slug UPDATEs against an existing
-- column, no DDL. All 18 slugs already exist as of 0105 (applied to CI;
-- 0105/0106 predate this PR), so no "insert first" branch is needed the way
-- 0105 needed one for genuinely new rows.
--
-- Not a value a client can write, same as 0104/0105/0106: `resume_templates`
-- has RLS enabled with no update policy, so `authenticated` cannot touch
-- either column regardless of the table-wide grant Supabase hands out.
--
-- ── NOT APPLIED HERE ───────────────────────────────────────────────────────
--
-- This file is committed unapplied to both the CI project
-- (dozaffzgqkbarxtlclsj) and production (nytwbbzfpytctjsoczzq). Applying a
-- free-tier cut to live data is the founder's own call, separate from this
-- PR's merge — `tests/billing/catalog-migration-parity.test.ts` parses this
-- file's SQL text directly and needs no live database to verify catalog.ts
-- agrees with it.

update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'business-memo';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'filing-system';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'product-tech';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'studio-brief';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'field-notes';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'help-desk';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'compliance-brief';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'clinical';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'chambers';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'sprint-board';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'civic-record';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'byline';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'harvest';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'rig-report';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'network-ops';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'site-plan';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'front-desk';
update public.resume_templates set is_premium = true, unlock_cost_credits = 10 where slug = 'manifest';

-- Fail loudly rather than half-apply, same convention as 0042/0104/0105.
do $$
declare v_missing text;
begin
  select string_agg(slug, ', ') into v_missing
    from (
      select unnest(array[
        'business-memo','filing-system','product-tech','studio-brief',
        'field-notes','help-desk','compliance-brief','clinical','chambers',
        'sprint-board','civic-record','byline','harvest','rig-report',
        'network-ops','site-plan','front-desk','manifest'
      ]) as slug
    ) expected
    where not exists (
      select 1 from public.resume_templates rt
       where rt.slug = expected.slug
         and rt.is_premium = true
         and rt.unlock_cost_credits = 10
    );
  if v_missing is not null then
    raise exception
      'template free-tier cut did not apply cleanly for slug(s): %. Expected is_premium = true, unlock_cost_credits = 10.',
      v_missing;
  end if;
end
$$;
