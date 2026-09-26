-- 0197 — send-467, part 3: the calendar-driven win-back email.
--
-- Fixing the dormancy signal (0196) only repairs the EXISTING proactive
-- "exceptional match" alert (send-138) — and that alert only ever fires when
-- a new Excellent match also shows up in the same ingest run. A user who has
-- been gone 20 days with no fresh Excellent match in that window currently
-- hears nothing, ever. This is the one genuinely new send this project asked
-- for: "here's what's new since you've been away", triggered by the
-- calendar (a bounded window since `profiles.last_active_at`), not by an
-- ingest event.
--
-- Mirrors 0083/0131's own three-switch shape exactly, on this send's own
-- flag/preference/dedup rather than reusing either existing one — same
-- reasoning both of those migrations already gave: a shared flag or
-- preference column means you cannot ship or silence one without the other.
--
--   feature_flags.win_back_email          does the product send this AT ALL
--   email_preferences.win_back_email      does THIS PERSON want it
--   email_preferences.win_back_last_sent_at   dedup — see below
--
-- ── WHY THE DEDUP IS ONE TIMESTAMP COLUMN, NOT A SEPARATE EPISODE TABLE ────
--
-- "Once per dormancy episode" sounds like it needs its own row per episode,
-- but a single timestamp compared against `profiles.last_active_at` gives
-- exactly that for free: this cron only ever stamps `win_back_last_sent_at`
-- to a value that is AFTER the `last_active_at` it just read (the send only
-- happens because the user has been dormant since that timestamp). So on
-- every later day inside the SAME episode, `last_active_at` has not moved,
-- and `win_back_last_sent_at >= last_active_at` — the dedup condition below
-- (`win_back_last_sent_at is null or win_back_last_sent_at < last_active_at`)
-- correctly evaluates to "already sent, skip". The moment the user becomes
-- active again, `touch_last_active()` (0196) moves `last_active_at` forward
-- past the old `win_back_last_sent_at`, and the condition flips back to
-- "eligible" the next time they drift past 14 days again — a new episode,
-- correctly detected, with no second table and no explicit "episode id" to
-- maintain.
alter table public.email_preferences
  add column win_back_email boolean not null default true,
  add column win_back_last_sent_at timestamptz;

comment on column public.email_preferences.win_back_email is
  'Whether THIS PERSON wants the calendar-driven "here''s what you missed" win-back email (send-467). Separate from job_match_digest and proactive_match_alert on purpose — see 0083/0131''s own headers for why a shared column is the wrong shape here too.';

comment on column public.email_preferences.win_back_last_sent_at is
  'When this person''s CURRENT dormancy episode last got a win-back email, or null if it has not yet this episode. Compared against profiles.last_active_at, not a fixed lookback window — see this migration''s own header for why that single comparison is sufficient to dedupe "once per episode" with no separate table.';

insert into public.feature_flags (key, label, enabled) values
  ('win_back_email', 'Dormant user win-back email', false);

/*
 * Flips `email_preferences.win_back_email` using the SAME bearer token the
 * digest's `email_unsubscribe` and the proactive alert's
 * `proactive_match_alert_set_preference` already use — one row, one token,
 * a third independently-flippable preference. New function rather than
 * widening either existing one, for the same reason 0131 gave: each
 * existing caller's shape is already live in shipped emails.
 */
create or replace function public.win_back_email_set_preference(
  p_token text,
  p_enabled boolean default false
)
returns table (matched boolean, win_back_email boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  update public.email_preferences
     set win_back_email = p_enabled,
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

revoke all on function public.win_back_email_set_preference(text, boolean) from public;
grant execute on function public.win_back_email_set_preference(text, boolean) to service_role;

comment on function public.win_back_email_set_preference(text, boolean) is
  'Flip a user''s win-back-email preference using their existing unsubscribe token (0083). SECURITY DEFINER for the same reason as email_unsubscribe / proactive_match_alert_set_preference: email_preferences is service_role-only, so the token never reaches a client-side query.';
