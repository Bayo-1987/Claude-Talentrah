-- 0066 — remembering that someone has been shown the Farah hint.
--
-- ── WHY A PROFILES COLUMN AND NOT localStorage ────────────────────────────
--
-- The brief allowed either. localStorage would need no migration at all, which
-- is the argument for it, and there are two arguments against that together
-- decide it:
--
--   1. It is per-DEVICE, not per-user. "Shown only once" would mean once on a
--      phone and again on a laptop, which in this market is the normal case
--      rather than the edge one — the same person on a cheap Android and a
--      borrowed desktop.
--   2. There is no localStorage anywhere in src/. Introducing a second, weaker
--      persistence layer for one boolean is a new pattern to maintain for the
--      benefit of skipping a five-line migration.
--
-- CLAUDE.md's own framing settles it: `profiles` is described as "the table
-- whose grant list exists to grow", which is exactly why admin identity was
-- deliberately kept OUT of it. A dismissed-a-hint timestamp is the other side
-- of that line — user-owned, non-value-bearing, and the same category as
-- `locale` and `country` which are already granted.
--
-- ── WHY GRANTING UPDATE ON IT IS SAFE, STATED RATHER THAN ASSUMED ─────────
--
-- 0030 revoked table-level UPDATE on profiles and granted back an explicit,
-- deliberately narrow column list, because a row policy restricts rows and
-- never columns — the lesson 0026-0030 cost four findings to learn. Widening
-- that list is therefore a decision, not a formality, and the question to ask
-- of any new column is what a user gains by writing it a million times.
--
-- Here: nothing. The column gates one piece of UI chrome for the person doing
-- the writing. It carries no money, no trust, no identity, and nothing reads it
-- to make a decision about anyone else. Setting it to any value, or clearing
-- it, only changes whether that same user sees a hint. That is the same shape
-- as `locale`.
--
-- Column grants are additive, so this leaves 0030's list intact rather than
-- replacing it. `credits_balance`, `verified` and friends stay unwritable, and
-- tests/rls/column-privileges.test.ts is what keeps that true rather than this
-- comment.
--
-- A TIMESTAMP RATHER THAN A BOOLEAN, for one reason: "when did we stop showing
-- this" is answerable later and "true" is not. If the hint is ever changed
-- enough to be worth showing again, a null-or-older-than check is available
-- without a second migration. It costs the same eight bytes either way.

alter table public.profiles
  add column if not exists farah_hint_dismissed_at timestamptz;

comment on column public.profiles.farah_hint_dismissed_at is
  'When this user dismissed the first-visit Farah hint. Null means not yet dismissed. UI chrome only — nothing gates on it.';

grant update (farah_hint_dismissed_at) on public.profiles to authenticated;
