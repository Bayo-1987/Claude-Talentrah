-- 0063 — make a fresh database match the two real ones: catalog off by default.
--
-- ── THE GAP THIS CLOSES ──────────────────────────────────────────────────
--
-- The nine course rows were switched off directly against both databases:
--
--   update public.course_recommendations set active = false;
--
--   production nytwbbzfpytctjsoczzq   9 rows, 0 active
--   CI         dozaffzgqkbarxtlclsj   9 rows, 0 active
--
-- That was deliberate and correct — it decouples shipping the code from
-- exposing `?ref=talentrah-placeholder` affiliate links to real users, and it
-- keeps re-enablement to one statement with no redeploy. But it was a DATA
-- change made straight against the databases, so nothing in this repo recorded
-- it, and 0062 inserts without naming `active` — which takes 0061's column
-- default of `true`. The result:
--
--   a fresh database built from this repo   9 rows, 9 ACTIVE
--   production and CI                       9 rows, 0 active
--
-- So a fresh environment came up with the placeholder catalog LIVE while both
-- real environments had it dark. That is the same shape as the seed insert
-- 0062 exists to recover: a change that was true of the databases and absent
-- from the repo. Documenting it and asking the next person to remember a
-- manual UPDATE after seeding is the version of this that fails silently — and
-- it fails by showing placeholder affiliate links to users, which is the one
-- outcome the original UPDATE was performed to prevent.
--
-- ── WHY THIS DOES NOT CONTRADICT "A PLAIN UPDATE, NOT A MIGRATION" ───────
--
-- That instruction was about how the catalog gets switched BACK ON: flipping
-- `active` must stay one statement an operator can run, not a migration and a
-- deploy. It still is. This migration only settles what a database that has
-- never seen that operator's statement should start as, which is a different
-- question and the one the repo is responsible for answering.
--
-- ── SCOPED, NOT UNQUALIFIED ──────────────────────────────────────────────
--
-- `where affiliate_url like '%ref=talentrah-placeholder%'` rather than the
-- bare UPDATE that was run by hand. A migration runs once, so an unqualified
-- version would be safe today and wrong the moment someone applies this to a
-- database that has real offers in it — and the whole point of the placeholder
-- marker is that it identifies exactly the rows nobody has curated yet. Real
-- offers, whenever they arrive, are untouched by this.
--
-- Idempotent by construction: against production and CI the rows are already
-- inactive, so this updates nine rows to the value they already hold and
-- changes nothing observable.
--
-- ── WHEN THE REAL CODES ARRIVE ───────────────────────────────────────────
--
-- Re-enabling stays exactly one statement, unchanged by this file:
--
--   update public.course_recommendations set active = true where ...;
--
-- Do not "fix" that by reverting this migration. This governs the starting
-- state of a database, not the current state of a running one.

update public.course_recommendations
   set active = false,
       updated_at = now()
 where affiliate_url like '%ref=talentrah-placeholder%'
   and active;

comment on column public.course_recommendations.active is
  'Whether the offer is shown. Placeholder-URL rows ship inactive (0063) so a fresh environment matches production and CI; flipping this back on is a plain UPDATE, deliberately not a migration.';
