-- 0148 — Mentorship v2, part 2 (dispatched alongside send-153 automated
-- mentor payouts, seeker-paid-visibility, and human-review-verification-tier
-- — see those PRs for the other three slices of the same parallel dispatch).
--
-- ── SCOPE: WHY THIS STAYS ON JITSI RATHER THAN BUILDING GOOGLE MEET OAUTH ──
--
-- The brief for this slice explicitly offered a heavier option: real Google
-- Meet links via the Google Calendar API, which needs a mentor (and possibly
-- the mentee) to connect a Google account, token storage, refresh, and
-- revocation handling. Checked before choosing: `grep -r "oauth" src` finds
-- exactly ONE existing OAuth integration in this codebase — Google/LinkedIn
-- SIGN-IN (src/components/auth/oauth-buttons.tsx, src/lib/auth/actions.ts),
-- which authenticates a user against Supabase Auth and stores nothing beyond
-- what Supabase Auth itself keeps. There is no precedent anywhere in this
-- repo for a THIRD-PARTY API OAuth grant (calendar write scope, a token this
-- app itself stores, refreshes, and must notice going dead) — building one
-- would be new application architecture, not an increment on existing shape.
-- 0133's own header already named the actual blocker the first time this
-- exact call was made: "no Google Meet OAuth/Calendar credentials exist in
-- this environment, so a real Google Meet integration cannot honestly be
-- built" — that has not changed, and provisioning a real Google Cloud OAuth
-- client is outside what this session can do. Building the OAuth surface
-- without being able to obtain or test against real credentials would ship
-- untested token-lifecycle code for the exact failure mode (a dead token by
-- session time) the brief itself flags as the whole point of the exercise —
-- worse than not building it.
--
-- So: keep Jitsi (genuinely joinable, no credential to go stale), and spend
-- the effort on what the lighter option asks for — calendar invites (.ics,
-- attached to a real confirmation email that did not exist before this
-- slice) and a reminder before the session starts. Both are real product
-- gaps: `notifySessionConfirmed`/`confirmMentorSessionAction` previously sent
-- NO notification of any kind to either party — see src/lib/mentorship/notifications.ts.
--
-- ── THE ONE COLUMN THIS NEEDS ───────────────────────────────────────────────
--
-- reminder_sent_at mirrors user_passes.renewal_reminder_sent_at
-- (0018/src/lib/billing/renewals.ts) exactly: nullable, set once, and the
-- entire idempotency guard against a daily cron sending the same reminder
-- twice — "is null" is the whole check, same shape as every other
-- reminder-window job in this codebase (renewals.ts's own REMINDER_WINDOW_DAYS,
-- mentorship-sweep's own CONFIRMATION_DEADLINE_HOURS).
--
-- No column added to mentor_profiles — checked its live shape via the
-- Supabase MCP on both nytwbbzfpytctjsoczzq and dozaffzgqkbarxtlclsj
-- immediately before writing this migration (unchanged since 0133), and this
-- slice does not need one: the calendar invite and reminder both key off
-- mentorship_sessions, not mentor identity. Kept deliberately clear of
-- mentor_profiles specifically because send-153 (automated mentor payouts,
-- dispatched in parallel) is the slice most likely to add bank-detail columns
-- there — no reason to collide on a table this slice does not need to touch.
--
-- No RLS/grant changes needed: 0133 already did
-- `revoke update on public.mentorship_sessions from authenticated` at the
-- table level and only re-granted `mentee_notes, mentor_notes` back
-- column-by-column. A brand-new column is covered by neither the original
-- table-wide grant (revoked) nor the later column grant (named columns only),
-- so `reminder_sent_at` is service_role-only from the moment it exists —
-- verified directly in tests/mentorship/session-reminders.test.ts rather than
-- assumed.
alter table public.mentorship_sessions
  add column reminder_sent_at timestamptz;

comment on column public.mentorship_sessions.reminder_sent_at is
  'Set once, by runMentorshipSessionReminders, the first time this session''s pre-session reminder email/notification goes out. NULL means never sent — the guard a daily cron needs so a second run (or a manual admin-triggered POST racing the scheduled GET, same two-entry-point shape as every other cron route here) cannot send the same reminder twice.';

-- Keeps the daily reminder sweep's own work-list query index-friendly at
-- scale — the same reasoning email_preferences_digest_idx already gives for
-- an identical shape (a partial index on the exact WHERE clause the sender
-- actually runs), even though v1 mentorship volume does not need it yet.
create index mentorship_sessions_reminder_pending_idx
  on public.mentorship_sessions (scheduled_start)
  where status = 'confirmed' and reminder_sent_at is null;
