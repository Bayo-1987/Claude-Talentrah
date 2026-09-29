-- 0197 — Scholarship deadline alerts (send-466).
--
-- A saved scholarship's deadline is the single most time-boxed piece of
-- content this app has, and until now nothing in the scholarship pipeline
-- ever reminds anyone it is approaching. This adds a "closes in N days" email
-- for a saved scholarship, gated the same three-switch way the existing
-- digest and proactive match alert already are (see 0083, 0128's own
-- headers): a product-level feature flag, a per-person email preference, and
-- RESEND_API_KEY — none of the three substitutes for another.
--
-- ── WHY A NEW `email_preferences` COLUMN, NOT `job_match_digest` ───────────
--
-- Checked before assuming: this repo has faced this exact decision twice
-- already. 0083 (job_match_digest) and 0128/proactive_match_alert both give
-- their notification type its OWN column, explicitly reasoned in 0128's own
-- header — "A shared preference column would mean unsubscribing from the
-- weekly digest also silences the rare, high-value alert (or the reverse) —
-- two different asks, sharing a column that only remembers one answer." The
-- one place this repo did NOT add a column (0148, mentorship session
-- reminders) is a transactional reminder tied to an action the recipient
-- just took (booking a session) — there is no reasonable "opt out of being
-- told your own booked session is starting soon". A scholarship deadline
-- alert is the opposite shape: proactive, content-driven, and about a saved
-- item the person may or may not still care about — the same shape as the
-- digest and the proactive match alert, not the mentorship reminder. So this
-- follows 0128's precedent: its own column, its own flag, its own dedup.
--
-- ── THE DEADLINE-VERIFICATION BAR, REUSED RATHER THAN INVENTED ─────────────
--
-- `deadline_verified_at` already gates something in this codebase:
-- ingest.ts's auto-publish path treats a listing as safe to act on without a
-- human only when `deadline_verified_at is not null AND application_deadline
-- is not null AND application_deadline > today` (see ingest.ts's own
-- comment). Nothing in the seeker-facing UI reads deadline_verified_at at
-- all today — grepped before writing this — so this migration and the
-- selection logic it supports are the FIRST consumer of that column outside
-- ingestion. The bar is copied exactly: a scholarship with a null deadline,
-- or a non-null deadline nobody ever independently confirmed against its own
-- official source, does not get a "closes in N days" claim attached to it —
-- silence is correct there, not a best-guess date invented for urgency.
--
-- ── DEDUP, COPIED FROM renewals.ts / mentorship's OWN PATTERN ──────────────
--
-- `user_passes.renewal_reminder_sent_at` (0018) and
-- `mentorship_sessions.reminder_sent_at` (0148) are the same shape: a
-- nullable timestamp, set once after a successful send, checked with
-- `IS NULL` as the entire idempotency guard against a daily cron sending the
-- same reminder twice. `scholarship_saves.deadline_reminder_sent_at` copies
-- that shape exactly. Unlike a Pass renewal (which recurs and therefore
-- resets this column on each successful cycle, see extendPass in
-- renewals.ts), a scholarship's application deadline does not recur for a
-- given save — once reminded, this save never needs reminding again for
-- this cycle, so nothing here ever clears the column back to null.
--
-- ── NO COLUMN-GRANT CARVE-OUT FOR THE NEW scholarship_saves COLUMN ─────────
--
-- CLAUDE.md's own standing rule is that a value-bearing column added to a
-- user-writable table needs a deliberate decision, not silence. Checked
-- `scholarship_saves`' existing grants before deciding: unlike `profiles`,
-- `organizations` or `job_postings`, this table has never had ANY column-level
-- revoke — its single "scholarship saves are owner-only" FOR ALL policy
-- already lets the owner rewrite every column on their own row, including
-- `status`, `notes` and `outcome_note`. `deadline_reminder_sent_at` carries no
-- money, trust or identity, and the only party a forged value could affect is
-- the row's own owner (resetting it to null just re-arms their own reminder
-- email; setting it non-null just silences their own reminder early) — the
-- same self-only-harm shape this table's own `status` column already has.
-- So this deliberately does NOT narrow scholarship_saves' existing grant,
-- consistent with its current security posture rather than introducing a new,
-- inconsistent one.

alter table public.scholarship_saves
  add column deadline_reminder_sent_at timestamptz;

comment on column public.scholarship_saves.deadline_reminder_sent_at is
  'Set once, by runScholarshipDeadlineAlerts, the first time this save''s "closes in N days" reminder email goes out. NULL means never sent — the guard a daily cron needs so a second run cannot send the same reminder twice. Never cleared back to null: a scholarship''s deadline does not recur for a given save.';

-- Keeps the daily sweep's own work-list query index-friendly at scale, same
-- reasoning as mentorship_sessions_reminder_pending_idx (0148) and
-- email_preferences_digest_idx (0083): a partial index on the exact
-- predicate the sender's own query actually filters on.
create index scholarship_saves_deadline_reminder_pending_idx
  on public.scholarship_saves (scholarship_id)
  where deadline_reminder_sent_at is null and status in ('saved', 'applying');

alter table public.email_preferences
  add column scholarship_deadline_alert boolean not null default true;

comment on column public.email_preferences.scholarship_deadline_alert is
  'Whether THIS PERSON wants the "closes in N days" reminder for a scholarship they saved (send-466). Separate from job_match_digest and proactive_match_alert on purpose — see this migration''s own header.';

insert into public.feature_flags (key, label, enabled) values
  ('scholarship_deadline_alert', 'Scholarship deadline reminders', false);

/*
 * Flips `email_preferences.scholarship_deadline_alert` using the SAME bearer
 * token the digest's `email_unsubscribe` and 0128's
 * `proactive_match_alert_set_preference` already read — one row, one token,
 * a third independently-flippable preference. A new function rather than
 * widening either existing one, for the same reason 0128 gave: their shapes
 * are already live in shipped emails.
 */
create or replace function public.scholarship_deadline_alert_set_preference(
  p_token text,
  p_enabled boolean default false
)
returns table (matched boolean, scholarship_deadline_alert boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  update public.email_preferences
     set scholarship_deadline_alert = p_enabled,
         updated_at = now()
   where unsubscribe_token = p_token
  returning user_id into v_user;

  if v_user is null then
    return query select false, false;
  else
    return query select true, p_enabled;
  end if;
end;
$$;

revoke all on function public.scholarship_deadline_alert_set_preference(text, boolean) from public;
grant execute on function public.scholarship_deadline_alert_set_preference(text, boolean) to service_role;

comment on function public.scholarship_deadline_alert_set_preference(text, boolean) is
  'Flip a user''s scholarship-deadline-alert preference using their existing unsubscribe token (0083). SECURITY DEFINER for the same reason as email_unsubscribe/proactive_match_alert_set_preference: email_preferences is service_role-only, so the token never reaches a client-side query.';
