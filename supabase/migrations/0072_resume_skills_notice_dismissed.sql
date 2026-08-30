-- 0072 — remembering that someone has dismissed the empty-skills notice.
--
-- ── WHY A SECOND COLUMN AND NOT A REUSE OF 0066's ─────────────────────────
--
-- `farah_hint_dismissed_at` is the pattern this follows, deliberately, and it
-- is not the storage. They are two different notices about two different
-- things: one is a one-time nudge toward a feature, the other says a specific
-- user's resume parsed with no skills and their match scores are meaningless
-- until they fix it. Sharing a column would mean dismissing either one hides
-- both, and the second is the one that must survive being ignored once.
--
-- ── WHY THIS IS SAFE TO GRANT, STATED RATHER THAN ASSUMED ─────────────────
--
-- 0030 revoked table-level UPDATE on `profiles` and granted back an explicit,
-- narrow column list, because a row policy restricts rows and never columns —
-- the lesson 0026-0030 cost four findings to learn. Widening that list is a
-- decision each time, and the question to ask is what a user gains by writing
-- the column a million times.
--
-- Here: nothing. It hides one notice for the person doing the writing. It
-- carries no money, no trust and no identity, and nothing reads it to make a
-- decision about anyone else — the same shape as `locale` and as 0066's
-- column. Note in particular that dismissing does NOT change the underlying
-- condition: the resume still has no skills, the scores are still what they
-- are, and every other surface behaves identically. The only thing a user can
-- do by writing this is stop being told.
--
-- Column grants are additive, so 0030's list stays intact and
-- tests/rls/column-privileges.test.ts remains the check on that rather than
-- this comment.
--
-- A TIMESTAMP RATHER THAN A BOOLEAN, matching 0066 for the same reason: "when
-- did we stop showing this" is answerable later and "true" is not. If the
-- notice is ever reworded enough to be worth showing again, a
-- null-or-older-than check needs no second migration.

alter table public.profiles
  add column if not exists resume_skills_notice_dismissed_at timestamptz;

comment on column public.profiles.resume_skills_notice_dismissed_at is
  'When this user dismissed the "your resume has no skills" notice on the Resume Builder. Null means not yet dismissed. UI chrome only — nothing gates on it, and dismissing does not change the resume or its scores.';

grant update (resume_skills_notice_dismissed_at) on public.profiles to authenticated;
