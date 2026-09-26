-- 0195 — send-467, part 1: a real, independent "last active" signal.
--
-- ── THE BUG THIS EXISTS TO FIX ─────────────────────────────────────────────
--
-- src/lib/notifications/proactive-match-alert/select.ts's own
-- `isNotActivelySearching()` (send-138) defines "dormant" as "this user's
-- most recent `match_scores.computed_at` is 14+ days old", justified because
-- `computed_at` "updates on every real feed/job-detail visit ... because that
-- is precisely when this app recomputes it".
--
-- That stopped being true the very next day. `src/lib/matching/refresh-job.ts`
-- (`runMatchScoreRefreshJob`, the daily `refresh-match-scores` cron, shipped
-- 2026-09-11) ALSO writes `computed_at = now()` on every row it upserts — for
-- every user with a base resume, unconditionally, whenever a new eligible
-- posting appears that they have not been scored against yet. Given
-- continuous job ingestion, a genuinely dormant user keeps accumulating
-- unscored postings, so the background job keeps re-touching their
-- `computed_at` on a near-daily cadence — indistinguishable, from
-- `isNotActivelySearching()`'s point of view, from the user having visited
-- the feed themselves.
--
-- Confirmed against production (nytwbbzfpytctjsoczzq) before writing this:
-- of the users with any `match_scores` row, the oldest `computed_at` was 16
-- days old and every other one was under 8 days — and four users shared a
-- `computed_at` within 34 seconds of each other, the signature of the
-- refresh job's own sequential per-user loop, not four independent visits.
-- Zero proactive match alerts have ever been sent in production
-- (`select count(*) from proactive_match_alerts` = 0). The dormancy gate is,
-- in effect, permanently closed for anyone with a base resume the moment the
-- background job has touched them once.
--
-- ── THE FIX: A COLUMN THE BACKGROUND JOB STRUCTURALLY CANNOT TOUCH ─────────
--
-- `profiles.last_active_at` is stamped ONLY by `touch_last_active()` below,
-- which is SECURITY DEFINER but gated on `auth.uid()` and — the actually
-- load-bearing part — has EXECUTE granted to `authenticated` ONLY, never to
-- `service_role`. `refresh-job.ts`, `send.ts`, and every other background
-- job in this codebase runs as the service-role client; none of them has any
-- grant that lets them call this function, so this is not a convention
-- anyone has to remember to respect going forward, it is a privilege that
-- does not exist for them. A genuinely authenticated, real page view is the
-- only path that can ever move this column.
--
-- WHY A CONDITIONAL UPDATE, NOT A READ-THEN-WRITE. The function's own WHERE
-- clause (`last_active_at is null or last_active_at < now() - interval
-- '1 hour'`) is the throttle — CLAUDE.md's own standing rule that anything
-- gating on a compared value must check-and-act in one statement, applied
-- here to "is this stale enough to bump" rather than to a balance. This also
-- means the caller (src/lib/supabase/middleware.ts) never has to read the
-- column first: it fires the RPC unconditionally on every request from a
-- signed-in session, and the function itself is what makes that cheap —
-- 364 of 365 calls in a day for a daily visitor are a no-op UPDATE that
-- matches zero rows.
--
-- WHY NOT ADDED TO THE COLUMN-GRANT LIST ON `profiles` ITSELF. 0030 already
-- revoked table-level UPDATE from anon/authenticated and re-granted a named
-- list of safe, self-describing columns; 0135 restated that list. Checked
-- live against this project before writing this migration
-- (information_schema.column_privileges) — the current grant list is
-- first_name, last_name, country, locale, farah_hint_dismissed_at,
-- resume_skills_notice_dismissed_at, onboarding_skipped_at,
-- talent_directory_opt_in, talent_available_for_hire, talent_remote_ready,
-- talent_earliest_start_date. `last_active_at` is deliberately left off that
-- list — nothing in this migration adds it — so a direct
-- `update profiles set last_active_at = ...` from a user's own session
-- client stays refused with 42501, the same mechanism and the same negative
-- control this repo already has for `job_postings.closed_at`/`posted_at`
-- (see the new describe block added to tests/rls/column-privileges.test.ts
-- in this same send). No additional `revoke` statement is needed here
-- because the table-level revoke already covers a brand new column by
-- default — only an explicit `grant` would have made it writable, and this
-- migration deliberately does not issue one.
--
-- (Separately, and NOT fixed here: the same live query surfaced that 0135's
-- revoke+re-grant silently dropped the `referral_leaderboard_opt_in` /
-- `referral_leaderboard_display_name` columns 0130 had granted five
-- migrations earlier, and `setReferralLeaderboardPreferenceAction`
-- (src/lib/referrals/actions.ts) still updates them through the user's own
-- session client — a real, separate, currently-live bug, unrelated to
-- dormancy. Flagged for its own fix, not folded into this one.)

alter table public.profiles
  add column last_active_at timestamptz;

comment on column public.profiles.last_active_at is
  'Stamped ONLY by touch_last_active() below, from a real authenticated page view, throttled to once/hour. NOT a general "last touched this row" column — refresh-job.ts and every other service-role job has no grant to write it, by design (send-467). The dormancy signal for isNotActivelySearching() (proactive-match-alert/select.ts) and the win-back email (0196) both read this, never match_scores.computed_at.';

create or replace function public.touch_last_active()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
     set last_active_at = now()
   where id = (select auth.uid())
     and (last_active_at is null or last_active_at < now() - interval '1 hour');
$$;

-- No `service_role` grant, deliberately — see this migration's own header.
-- A background job that cannot call this function cannot use it to fake a
-- real visit, which is the entire point of a signal a background job
-- "structurally cannot touch".
--
-- ALL THREE of these revokes are load-bearing, not just the first. Checked
-- live before finalising this migration (information_schema.role_routine_grants):
-- a bare `revoke all ... from public` does NOT remove `anon` or
-- `service_role`'s own EXECUTE — Supabase's project bootstrap grants EXECUTE
-- on every function in `public` to `anon`, `authenticated` AND `service_role`
-- independently of the PUBLIC pseudo-role, the same "table grant overrides a
-- narrower revoke" trap CLAUDE.md already documents for tables (0026/0028),
-- just on functions instead. `revoke ... from public` alone is exactly what
-- 0083's `email_unsubscribe` and 0131's `proactive_match_alert_set_preference`
-- did, and a live check while writing THIS migration found `anon` still holds
-- EXECUTE on both today — harmless there only because a bearer token is the
-- entire authorization model for those two (see 0083's own "NO SESSION, BY
-- NECESSITY"), not because the revoke worked as written. `touch_last_active`
-- has no such excuse: its whole safety property is WHO can call it, so this
-- migration revokes from `anon` and `service_role` explicitly, by name, and
-- was re-verified against the live project after applying (`anon` and
-- `service_role` both absent from role_routine_grants, `authenticated` alone
-- present) rather than trusted on the strength of the SQL alone.
revoke all on function public.touch_last_active() from public;
revoke all on function public.touch_last_active() from anon;
revoke all on function public.touch_last_active() from service_role;
grant execute on function public.touch_last_active() to authenticated;

comment on function public.touch_last_active() is
  'Stamps profiles.last_active_at = now() for the CALLING user only (auth.uid()), throttled to once/hour via its own WHERE clause (one atomic statement, no read-then-write). Called from src/lib/supabase/middleware.ts on every request that has a session, fire-and-forget. EXECUTE is granted to authenticated only, never service_role or anon — see this migration''s own header for why that omission is load-bearing.';
