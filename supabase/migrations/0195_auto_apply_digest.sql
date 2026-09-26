-- send-463 — "here's what Farah did for you this week": Auto-Apply
-- proof-of-work digest.
--
-- ── WHY THIS REUSES email_preferences.job_match_digest, NOT A NEW COLUMN ───
--
-- 0131's own header argues for a SEPARATE preference column per notification
-- type ("a shared preference column would mean unsubscribing from the weekly
-- digest also silences the rare, high-value alert"). That reasoning does not
-- transfer cleanly here: a new column with no way to actually flip it is
-- worse than sharing one. This repo's only opt-out mechanism today is the
-- token-based /unsubscribe flow (0083's email_unsubscribe,
-- src/app/unsubscribe/), and building a second, parallel unsubscribe path
-- for one more preference is real, additional scope this send does not ask
-- for. Reusing job_match_digest means both weekly emails share the one
-- unsubscribe link that already exists and already works — a real, checked
-- reason to reuse, not a shortcut past 0131's own logic.
--
-- ── THE THIRD GATE: A DEDICATED FEATURE FLAG, SAME SHAPE AS THE MATCH
-- DIGEST'S OWN ────────────────────────────────────────────────────────────
--
-- sendAutoApplyDigest mirrors sendJobMatchDigest's exact three-gate
-- structure — feature flag, per-user preference, RESEND_API_KEY — so this
-- flag exists for the same reason job_match_digest's own flag does: ships
-- switched off, turned on by an admin once someone has actually checked the
-- copy against real production queue data.
--
-- ── digest_last_sent_at's OWN SHAPE, REPEATED FOR THE NEW SEND ─────────────
--
-- Named auto_apply_digest_last_sent_at rather than reusing digest_last_sent_at
-- — these are two independently-scheduled sends (both weekly, but a shared
-- stamp would make one send's success silently suppress the other's next
-- run). Same table as the match digest's own stamp, since both digests
-- already read the same recipient list from email_preferences.

alter table public.email_preferences
  add column auto_apply_digest_last_sent_at timestamptz;

comment on column public.email_preferences.auto_apply_digest_last_sent_at is
  'Set only after a successful Auto-Apply proof-of-work digest send (send-463) — same "stamp only on success" rule as digest_last_sent_at, so a failed send retries next week rather than being silently skipped.';

-- Mirrors email_preferences_digest_idx exactly, for the new send's own
-- work-list query.
create index email_preferences_auto_apply_digest_idx
  on public.email_preferences (job_match_digest, auto_apply_digest_last_sent_at)
  where job_match_digest;

insert into public.feature_flags (key, label, enabled) values
  ('auto_apply_digest', 'Auto-Apply weekly proof-of-work digest emails', false);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'email_preferences'
      and column_name = 'auto_apply_digest_last_sent_at'
  ) then
    raise exception 'email_preferences.auto_apply_digest_last_sent_at was not created';
  end if;

  if not exists (
    select 1 from public.feature_flags where key = 'auto_apply_digest'
  ) then
    raise exception 'auto_apply_digest feature flag row was not created';
  end if;
end $$;
