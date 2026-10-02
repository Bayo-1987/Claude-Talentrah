-- 0205 — Talent Directory waitlist (EMP-1 / E1).
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
-- Production, measured read-only on 2026-10-02: ONE opted-in, verified candidate out of 16 profiles, and no active directory
-- subscription. A ₦200,000/month subscription (talent_directory_plans, 0135) cannot be sold against a pool of one. Below
-- TALENT_DIRECTORY_MIN_LISTED (10, src/lib/talent-directory/preview.ts) the employer page hides Subscribe and offers a waitlist instead:
-- "tell us you want in, and we'll tell you when 10+ are listed". This table is that list.
--
-- ── WHY A NEW TABLE, NOT THE EXISTING CONTACT PATH ──────────────────────────
-- The only lead-capture path in the repo is /contact (src/lib/contact/actions.ts): a public form that sends an e-mail to the support
-- inbox through Resend. It stores nothing. A waitlist has to be a durable, queryable set of organisations (so "10+ listed" can be acted
-- on), it has to be idempotent per organisation (a second click must not duplicate or error), and a signed-in employer must not be asked
-- to retype a name and address we already hold. An e-mail in an inbox is none of those. So: one small table.
--
-- ── SHAPE ───────────────────────────────────────────────────────────────────
-- One row per ORGANISATION (unique), not per user: the buyer of a directory subscription is the organisation, and two colleagues clicking
-- "Join" is one expression of interest, not two. `joined_by` records who first asked; a later join by a colleague changes nothing.
-- ON DELETE CASCADE on organization_id: a waitlist entry has no meaning without its organisation and must never block deleting one
-- (job_postings and payment_transactions are the NO ACTION FKs that do, by design; this is not one of them).
-- ON DELETE SET NULL on joined_by: removing a user's account does not remove the organisation's place on the list.
--
-- ── LOCKED DOWN ─────────────────────────────────────────────────────────────
-- RLS is enabled with NO policy, and every grant to anon and authenticated is revoked: Supabase grants ALL on every new table to those
-- roles by default (0151's lesson), and RLS-with-no-policy alone would still leave the grants in place. Nothing a client can send reads
-- or writes this table. The only writer is joinTalentDirectoryWaitlist (src/lib/talent-directory/waitlist-runner.ts), which runs as the
-- service role AFTER requireEmployer() has established the caller's organisation from their session, never from client input. There is no
-- client read at all: the page learns "is my organisation on the list" through the same service-role path.
--
-- Additive: a new table, nothing existing is altered. Apply BEFORE merging (supabase/migrations/README.md).

create table public.talent_directory_waitlist (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  joined_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.talent_directory_waitlist is
  'Organisations that asked to be told when the Talent Directory has enough verified candidates (TALENT_DIRECTORY_MIN_LISTED). One row per organisation. Written ONLY by the service role (joinTalentDirectoryWaitlist); no client role has any privilege on it.';

alter table public.talent_directory_waitlist enable row level security;

revoke all on table public.talent_directory_waitlist from anon, authenticated;
