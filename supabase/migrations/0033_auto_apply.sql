-- 0033 — Auto-Apply (Phase 2, first milestone).
--
-- build-prompt §2.3 is explicit that this is "a trust feature, not a volume
-- feature", and CLAUDE.md names it as one of three things separating Talentrah
-- from spam-auto-apply competitors. The schema below is shaped by that, not by
-- what would be easiest to query.
--
-- ---------------------------------------------------------------------------
-- The security contract this inherits
-- ---------------------------------------------------------------------------
-- 0031 locked `match_scores` to service-role writes with the comment "a
-- user-writable score is a user-writable trigger for automated applications
-- sent under their name". This is that trigger. So every value Auto-Apply
-- decides on is server-owned:
--
--   * the match score comes from `match_scores` (client cannot write it, 0031)
--   * the threshold and the caps are server constants, not columns a user sets
--   * the queue is service-role-write-only; the user's own client can read
--     their queue and nothing else
--
-- The one thing a user genuinely owns — whether the feature is on — is the one
-- thing they can write, and it is the only column granted below.
--
-- ---------------------------------------------------------------------------
-- Why a queue table rather than reusing application_stage_events
-- ---------------------------------------------------------------------------
-- Checked before adding, per the "don't duplicate, don't force-fit" rule.
-- `application_stage_events` records stage transitions of applications that
-- ALREADY EXIST. Auto-Apply's whole safety property is that a match sits in a
-- "queued, not yet real" state that has no `applications` row at all — there is
-- nothing for that table to hang an event off, and inventing a placeholder
-- application row to log against would defeat the review gate it exists to
-- record. Different lifecycle, different table.
--
-- This table doubles as the auditable log build-prompt §8 asks for — what
-- (job_posting_id), when (queued_at / decided_at), what happened (status), and
-- what it cost (credits_spent). Rows are never deleted on decision; they are
-- resolved in place, so the log survives the decision.

create type public.auto_apply_status as enum (
  'pending',      -- surfaced to the user, awaiting review. Nothing has happened yet.
  'submitted',    -- internal job: a real application row was created on their behalf
  'handed_off',   -- external job: the user was sent to the source posting to finish
  'dismissed',    -- the user said no
  'expired'       -- the posting closed, or the queue entry aged out, before review
);

-- Beyond the free allowance, a confirmed internal submission costs credits, the
-- same principle as tailoring (build-prompt §6.9). The value is added here and
-- deliberately NOT used in this migration — Postgres permits ALTER TYPE ... ADD
-- VALUE inside a transaction only if the new label is not referenced in the
-- same one.
alter type public.credit_reason add value if not exists 'auto_apply_run';

-- ---------------------------------------------------------------------------
-- Settings — one row per user, and exactly one thing they may change
-- ---------------------------------------------------------------------------
create table public.auto_apply_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  -- Recorded so the activity log can answer "since when", and so a support
  -- question about an unexpected application has an on/off history to read.
  enabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.auto_apply_settings enable row level security;

create policy "auto-apply settings are owner-only"
  on public.auto_apply_settings
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- The column-privilege discipline from 0028/0030, applied at the point of
-- creation rather than after someone finds a hole. `enabled_at` is a server
-- observation about when the toggle flipped, not a field to set.
revoke update on public.auto_apply_settings from anon, authenticated;
grant update (enabled, updated_at) on public.auto_apply_settings to authenticated;

-- ---------------------------------------------------------------------------
-- The queue / activity log
-- ---------------------------------------------------------------------------
create table public.auto_apply_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,

  -- Snapshotted at queue time, from match_scores. Kept on the row so the log
  -- still explains WHY something was queued after the score is recomputed —
  -- scores are a cache that changes whenever the résumé or the feed does.
  match_score integer not null check (match_score between 0 and 100),
  tier text not null,
  -- Snapshotted too: it decides whether confirming submits or hands off, and
  -- reading it live would change the meaning of an old log entry.
  source_type public.job_source_type not null,

  status public.auto_apply_status not null default 'pending',
  queued_at timestamptz not null default now(),
  decided_at timestamptz,
  application_id uuid references public.applications(id) on delete set null,
  credits_spent integer not null default 0,

  -- One queue entry per user per job, ever. Without this, a repeated scan
  -- re-queues everything the user already dismissed.
  constraint auto_apply_queue_user_job_key unique (user_id, job_posting_id)
);

alter table public.auto_apply_queue enable row level security;

-- Read-only to its owner. There is no INSERT/UPDATE policy on purpose: queuing
-- and resolving both happen server-side, so a user cannot queue a job they
-- don't qualify for, mark one submitted without one being submitted, or edit
-- what the log says happened.
create policy "auto-apply queue is owner-readable"
  on public.auto_apply_queue
  for select
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.auto_apply_queue from anon, authenticated;

create index auto_apply_queue_user_status_idx
  on public.auto_apply_queue (user_id, status, queued_at desc);
-- Serves the rolling-window cap and free-allowance counts, which both filter on
-- decided_at within an interval.
create index auto_apply_queue_user_decided_idx
  on public.auto_apply_queue (user_id, decided_at desc)
  where decided_at is not null;
