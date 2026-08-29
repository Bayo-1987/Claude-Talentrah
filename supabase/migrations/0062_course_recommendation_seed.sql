-- 0062 — the nine catalog rows that were live before they were in version control.
--
-- ── WHAT THIS RECOVERS ───────────────────────────────────────────────────
--
-- `0061_course_recommendations.sql` (applied as `0060_course_recommendations`,
-- before the renumbering — see its header) created the two course tables. The
-- SQL that ACTUALLY RAN against both databases had thirteen statements. The
-- file committed to this repo has twelve. The missing one is an
-- `insert into public.course_recommendations` seeding nine affiliate offers,
-- and it is why both projects have a populated catalog that no migration in
-- this repo accounts for:
--
--   production nytwbbzfpytctjsoczzq   9 rows
--   CI         dozaffzgqkbarxtlclsj   9 rows
--   fingerprint 6476ef99733ba3096e6598334708ad15 on both — byte-identical
--
-- Two things followed from that gap, and only the second is obvious. A fresh
-- environment rebuilt from this repo came up with empty tables while both real
-- environments were populated — annoying, recoverable. The one that matters:
-- nine rows carrying `?ref=talentrah-placeholder` REVENUE-ATTRIBUTION URLs
-- were written to production by a migration whose reviewable form does not
-- mention them. Nobody reviewing that diff could have seen the data, because
-- the data was not in the diff.
--
-- The values below were read back out of production rather than retyped, so
-- this is the state that exists, not the state someone remembers writing.
--
-- ── WHY A NEW MIGRATION AND NOT AN EDIT TO 0061 ──────────────────────────
--
-- Because 0061 is already recorded server-side, under its pre-rename name, in
-- both projects' `supabase_migrations.schema_migrations`. Editing an applied
-- migration makes the file disagree with the record of what ran and cannot be
-- re-applied to fix it; the same reasoning kept `0060_admin_identity.sql`
-- untouched when its number was contested. An applied migration is history.
-- History gets appended to, not rewritten.
--
-- ── WHY THE INSERT IS IDEMPOTENT ─────────────────────────────────────────
--
-- `on conflict … do nothing` against `course_recommendations_unique_offer`,
-- the (provider, skill_tag, title) constraint 0061 already declares. This
-- migration therefore has two different correct outcomes and needs no flag to
-- tell them apart:
--
--   * against production and CI, where the rows exist -> inserts 0, changes
--     nothing, and simply records that the repo now accounts for them.
--   * against a fresh database -> inserts all 9, matching the two real
--     environments.
--
-- `do nothing` rather than `do update` on purpose. If someone has since
-- corrected an affiliate URL or retired an offer in production, this must not
-- quietly revert it to the placeholder values below. Recovering a record of
-- what was seeded is the job; overwriting whatever it has become since is not.
--
-- ── THE URLs ARE PLACEHOLDERS AND SHOULD NOT SHIP AS THEY ARE ────────────
--
-- All nine carry `?ref=talentrah-placeholder`, which is not a real affiliate
-- code. Reproduced verbatim because this migration's job is to make the repo
-- honest about what is live, not to improve it — but they are live, on a
-- publicly readable table, and replacing them with real codes (or emptying the
-- catalog until there are any) is a separate, deliberate change that somebody
-- still owes.

insert into public.course_recommendations
  (skill_tag, provider, title, affiliate_url, price_tier)
values
  ('aws', 'altschool', 'AltSchool of Cloud Engineering', 'https://altschoolafrica.com/schools/cloud?ref=talentrah-placeholder', 'mid'),
  ('data analysis', 'altschool', 'AltSchool of Data', 'https://altschoolafrica.com/schools/data?ref=talentrah-placeholder', 'mid'),
  ('digital marketing', 'altschool', 'AltSchool of Digital Marketing (Growth Track)', 'https://altschoolafrica.com/schools/marketing?ref=talentrah-placeholder', 'low'),
  ('javascript', 'altschool', 'AltSchool Frontend Engineering', 'https://altschoolafrica.com/schools/engineering/frontend?ref=talentrah-placeholder', 'mid'),
  ('product management', 'altschool', 'AltSchool of Product Management', 'https://altschoolafrica.com/schools/product-management?ref=talentrah-placeholder', 'mid'),
  ('python', 'altschool', 'AltSchool Backend Engineering (Python)', 'https://altschoolafrica.com/schools/engineering/backend?ref=talentrah-placeholder', 'mid'),
  ('react', 'altschool', 'AltSchool Frontend Engineering', 'https://altschoolafrica.com/schools/engineering/frontend?ref=talentrah-placeholder', 'mid'),
  ('sql', 'altschool', 'AltSchool of Data — SQL Foundations', 'https://altschoolafrica.com/schools/data/sql?ref=talentrah-placeholder', 'free'),
  ('ui/ux', 'altschool', 'AltSchool of Product Design', 'https://altschoolafrica.com/schools/product-design?ref=talentrah-placeholder', 'mid')
on conflict on constraint course_recommendations_unique_offer do nothing;
