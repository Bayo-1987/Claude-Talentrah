-- send-453: a fixed, reused pool of throwaway auth users for the local/agent
-- test harness (tests/support/auth.ts), replacing a create-then-delete cycle
-- per test that was measured generating 1,564 user_deleted + 559
-- user_signedup events in a single 24h window against the shared
-- dozaffzgqkbarxtlclsj project (CLAUDE.md's send-441-follow-up entry).
--
-- APPLIED TO BOTH PROJECTS, same as every migration in this repo (see
-- supabase/migrations/README.md) — but this table and its functions are
-- NEVER referenced by application code, only by the test harness, which
-- only ever runs against dozaffzgqkbarxtlclsj (or a local `db:local`
-- stack) per scripts/db-target.ts's own refusal guard. Production carries
-- this schema inert, the same way it carries every other migration whether
-- or not that PR's own feature ever gets exercised there.
--
-- ── WHY A DB TABLE, NOT JS-SIDE BOOKKEEPING ─────────────────────────────
--
-- The problem this exists to solve is concurrent local/agent SESSIONS
-- (different processes, sometimes different machines) sharing one
-- database — CLAUDE.md's own standing warning. Coordinating "which pool
-- user is free right now" across separate processes needs a shared point
-- of truth, and the shared Postgres project already IS that point of
-- truth. `claim_test_pool_user` uses `FOR UPDATE SKIP LOCKED` so two
-- concurrent claims never race onto the same row and never block waiting
-- on each other — the same atomic check-and-act-in-one-statement discipline
-- CLAUDE.md holds up for spend_credits_atomic/auto_apply_claim_submission,
-- applied to a resource pool instead of a balance.
--
-- ── WHY RESET HAPPENS ON CLAIM, NOT ON RELEASE ──────────────────────────
--
-- A process can die mid-test without ever calling release (the exact
-- "process killed before afterAll runs" failure mode fixture-accounts.ts's
-- own header already documents for the unpooled path). Resetting on release
-- would leave a crashed run's dirty data sitting in the pool indefinitely;
-- resetting on claim means the NEXT claimant always gets a clean row
-- regardless of how the previous one exited.
--
-- ── WHAT "CLEAN" MEANS, AND WHAT IT DELIBERATELY DOES NOT COVER ─────────
--
-- reset_test_pool_user wipes the pool user's OWN records — resumes,
-- applications, credit ledger entries, referrals they were REFERRED into,
-- mentor rows, farah chat history, and so on — from an explicit,
-- hand-reviewed allowlist of (table, column) pairs (see that function's
-- own header for why this is a reviewed list rather than catalog
-- introspection: introspection found and would have deleted OTHER
-- people's rows, not just this user's own).
--
-- It deliberately does NOT touch `organizations`/`job_postings`/
-- `ad_campaigns` or similar: those are owned via a business entity, not
-- directly and exclusively by the user, and every suite that creates one
-- already cleans it up itself (deleteOrgsCascade and friends) regardless
-- of whether the auth user is pooled or freshly created — that discipline
-- predates this migration and is unchanged by it.
create table public.test_user_pool (
  user_id uuid primary key references auth.users(id) on delete cascade,
  leased_by text,
  leased_at timestamptz,
  prefix text,
  created_at timestamptz not null default now()
);

comment on table public.test_user_pool is
  'Test-harness-only: a reusable pool of throwaway auth users for tests/support/auth.ts. Never read or written by application code.';

-- Supabase grants ALL ON ALL TABLES to `authenticated` by default
-- (CLAUDE.md's own standing gotcha) — this table has no legitimate
-- authenticated-role caller at all, only the service-role client the test
-- harness already uses, which bypasses RLS/grants entirely. Revoke
-- explicitly rather than rely on no policy existing.
revoke all on public.test_user_pool from authenticated, anon;

-- `p_new_email` is set on `profiles` here so it's consistent with the pool
-- row the instant this transaction commits; the caller still updates
-- `auth.users.email` itself afterward through the ordinary, supported
-- `admin.auth.admin.updateUserById` API rather than this function reaching
-- into the `auth` schema directly. The brief window between the two is
-- invisible to everyone else, because this row is already exclusively
-- leased to this caller by the time either update runs.
--
-- ── WHY THIS IS AN EXPLICIT ALLOWLIST, NOT CATALOG INTROSPECTION ────────
--
-- An earlier version of this function walked `information_schema` for
-- every table with ANY foreign key column pointing at `auth.users(id)` or
-- `profiles(id)` and deleted all of it. That is unsafe in a way testing
-- against a real, populated CI project caught immediately: several of
-- those columns are not ownership at all, they are an ACTOR recorded on
-- SOMEONE ELSE'S row — `job_postings.admin_reviewed_by`,
-- `organizations.cac_confirmed_by`, `feedback.triaged_by`,
-- `scholarships.moderated_by`, `ad_wallet_ledger.actor_user_id` and
-- similar. A blanket delete keyed on any of those would erase a
-- DIFFERENT, unrelated row (someone else's job posting, another org's ad
-- ledger) purely because this pool user happened to review or moderate it
-- in an earlier life. Worse, `profiles.referred_by` is itself a direct FK
-- to `profiles.id` — the naive version would have deleted every OTHER
-- profile this pool user ever referred, i.e. real accounts, the instant
-- it was reused. Caught here, in this migration, before it ever ran
-- against production or a real developer's data, specifically BECAUSE it
-- was tested against a live, non-empty project rather than only against
-- an empty schema.
--
-- So this list is hand-reviewed, one row per (table, column) that
-- genuinely represents the pool user's OWN record — `user_id`,
-- `referred_user_id`, `candidate_id` — never an actor/reviewer/moderator
-- column recorded on somebody else's row. `organizations`, `job_postings`,
-- `ad_campaigns` and `referrals.referrer_id` are deliberately absent for
-- the same reason `organizations`/`job_postings` were always meant to be
-- absent (this function's own header): they are owned via a business
-- entity or a DIFFERENT person's record, not directly and exclusively by
-- this user, and every suite that creates one already cleans it up itself.
--
-- `email_preferences` is ALSO absent from this delete list, for a third,
-- different reason — found the same way, by testing against real data:
-- it is a 1:1 settings row (primary key `user_id`) that `profiles_ensure_
-- email_preferences` creates via an INSERT trigger on `profiles`, which
-- never re-fires for a reused id (nothing re-inserts `profiles`, only
-- updates it). Deleting the row would leave a claimed pool user with NO
-- preferences row at all — exactly the assumption
-- `tests/rls/email-preferences.test.ts` makes and a real page would too.
-- So it gets the same treatment as `profiles` itself: reset in place
-- below, including a fresh `unsubscribe_token` (a bearer credential per
-- that table's own header — a stale one from a previous claimant must not
-- keep working for whoever holds this identity now).
create or replace function public.reset_test_pool_user(p_user_id uuid, p_new_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- `mentor_profiles` (below) has its own known NO ACTION blocker worth
  -- resolving up front rather than leaving to the per-table exception
  -- catch: talent_verifications.reviewer_id is nullable (unlike the three
  -- mentor-side FKs on mentorship_sessions/mentorship_reviews/
  -- mentor_payouts, which are NOT NULL and genuinely cannot be resolved
  -- this way — a pool user that ran a real mentor session/review/payout
  -- can legitimately keep its mentor_profiles row across reuse; the
  -- exception handler below reports and skips it rather than aborting,
  -- same as any other blocked table).
  update public.talent_verifications set reviewer_id = null where reviewer_id = p_user_id;

  for r in
    select * from (values
      ('admin_users', 'id'),
      ('ad_events', 'user_id'),
      ('api_rate_limits', 'user_id'),
      ('application_stage_events', 'user_id'),
      ('applications', 'user_id'),
      ('auto_apply_queue', 'user_id'),
      ('auto_apply_settings', 'user_id'),
      ('country_default_events', 'user_id'),
      ('course_recommendation_clicks', 'user_id'),
      ('credit_gate_events', 'user_id'),
      ('credit_ledger', 'user_id'),
      ('farah_messages', 'user_id'),
      ('farah_session_events', 'user_id'),
      ('feedback', 'user_id'),
      ('job_posting_reports', 'reporter_id'),
      ('job_tailoring_requests', 'user_id'),
      ('match_scores', 'user_id'),
      ('mentor_profiles', 'user_id'),
      ('mentorship_reviews', 'reviewer_id'),
      ('mentorship_sessions', 'mentee_id'),
      ('organization_members', 'user_id'),
      ('payment_transactions', 'user_id'),
      ('proactive_match_alerts', 'user_id'),
      ('referral_shares', 'user_id'),
      ('referrals', 'referred_user_id'),
      ('resume_builder_start_events', 'user_id'),
      ('resumes', 'user_id'),
      ('scholarship_saves', 'user_id'),
      ('talent_directory_boosts', 'user_id'),
      ('talent_directory_contact_requests', 'candidate_id'),
      ('talent_portfolio_items', 'user_id'),
      ('talent_verifications', 'user_id'),
      ('user_notifications', 'user_id'),
      ('user_passes', 'user_id')
    ) as t(table_name, column_name)
    where exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = t.column_name
    )
  loop
    -- A handful of these ARE genuinely the user's own row and still hit a
    -- NO ACTION foreign key from somewhere else (a mentor_profiles row a
    -- talent_verification still names as reviewer_id, a mentorship_session
    -- a payment_transactions row references) — best-effort, same stance
    -- deleteTestUsers/clearAssessmentExerciseFiles already take elsewhere:
    -- report, don't abort the whole reset over one blocked table.
    begin
      execute format('delete from public.%I where %I = $1', r.table_name, r.column_name) using p_user_id;
    exception when foreign_key_violation then
      raise warning 'reset_test_pool_user: left % rows in place for % (blocked by a foreign key): %',
        r.table_name, p_user_id, sqlerrm;
    end;
  end loop;

  -- Reset the profiles row itself to the same defaults handle_new_user
  -- would produce for a brand-new signup, keeping id/referral_code (the
  -- columns that make it findable/usable) untouched. `email` is set to
  -- the NEW claim's email — see the function comment above.
  update public.profiles set
    email = p_new_email,
    first_name = null,
    last_name = null,
    country = null,
    market_segment = 'home',
    locale = 'en',
    referred_by = null,
    free_trial_tailoring_used = false,
    free_trial_cover_letter_used = false,
    credits_balance = 0,
    farah_hint_dismissed_at = null,
    resume_skills_notice_dismissed_at = null,
    onboarding_skipped_at = null,
    referral_leaderboard_opt_in = false,
    referral_leaderboard_display_name = null,
    talent_directory_opt_in = false,
    talent_verification_status = 'unverified',
    talent_verification_score = null,
    talent_verified_at = null,
    talent_available_for_hire = false,
    talent_remote_ready = false,
    talent_earliest_start_date = null,
    talent_boosted_until = null,
    updated_at = now()
  where id = p_user_id;

  -- See this function's own header on why email_preferences is reset in
  -- place rather than deleted: it's a 1:1 row nothing re-creates for a
  -- reused id. `insert ... on conflict` handles both "never had one" (a
  -- freshly-added pool member, added via add_test_pool_user right after
  -- creation) and "had one from a previous claim" in the same statement.
  -- `gen_random_bytes` lives in the `extensions` schema on this project
  -- (pgcrypto), not `public` — this function's own `set search_path =
  -- public` would otherwise hide it, unlike the column's own DEFAULT
  -- expression, which isn't subject to a function's search_path.
  insert into public.email_preferences (user_id, job_match_digest, unsubscribe_token, digest_last_sent_at, proactive_match_alert)
  values (p_user_id, true, encode(extensions.gen_random_bytes(32), 'hex'), null, true)
  on conflict (user_id) do update set
    job_match_digest = excluded.job_match_digest,
    unsubscribe_token = excluded.unsubscribe_token,
    digest_last_sent_at = excluded.digest_last_sent_at,
    proactive_match_alert = excluded.proactive_match_alert,
    updated_at = now();
end;
$$;

revoke all on function public.reset_test_pool_user(uuid, text) from public, authenticated, anon;

-- Atomically claims one available (or abandoned) pool row, resets it, and
-- returns its user_id — or NULL if the pool is empty/fully leased, in
-- which case the caller's own fallback is to create a fresh user exactly
-- as it did before this migration existed.
create or replace function public.claim_test_pool_user(
  p_lease_id text,
  p_prefix text,
  p_new_email text,
  p_stale_after_seconds int default 600
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select user_id into v_user_id
  from public.test_user_pool
  where leased_by is null
     or leased_at < now() - make_interval(secs => p_stale_after_seconds)
  order by leased_at nulls first
  limit 1
  for update skip locked;

  if v_user_id is null then
    return null;
  end if;

  update public.test_user_pool
  set leased_by = p_lease_id, leased_at = now(), prefix = p_prefix
  where user_id = v_user_id;

  perform public.reset_test_pool_user(v_user_id, p_new_email);

  return v_user_id;
end;
$$;

revoke all on function public.claim_test_pool_user(text, text, text, int) from public, authenticated, anon;

-- Only releases a lease this SAME lease_id currently holds — a lease that
-- has already been reclaimed as stale by a different process (and is now
-- doing real work for that process) must not be released out from under
-- it by its former, slow holder finally getting around to cleanup.
create or replace function public.release_test_pool_user(p_user_id uuid, p_lease_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.test_user_pool
  set leased_by = null, leased_at = null
  where user_id = p_user_id and leased_by = p_lease_id;
$$;

revoke all on function public.release_test_pool_user(uuid, text) from public, authenticated, anon;

-- Adds a freshly-created auth user to the pool, immediately leased by its
-- creator — used when the pool has not yet reached its size cap and needs
-- to grow. `on conflict do nothing` makes this safe to call more than once
-- for the same id without erroring (not expected, but cheap to make inert).
create or replace function public.add_test_pool_user(p_user_id uuid, p_lease_id text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.test_user_pool (user_id, leased_by, leased_at)
  values (p_user_id, p_lease_id, now())
  on conflict (user_id) do nothing;
$$;

revoke all on function public.add_test_pool_user(uuid, text) from public, authenticated, anon;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'test_user_pool'
  ) then
    raise exception 'test_user_pool table did not get created';
  end if;
  if not exists (
    select 1 from information_schema.routines
    where routine_schema = 'public' and routine_name = 'claim_test_pool_user'
  ) then
    raise exception 'claim_test_pool_user did not get created';
  end if;
end $$;
