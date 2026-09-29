-- 0201 — reset_test_pool_user finally clears a former mentor's/mentee's
-- mentorship rows, fixing the recurring `mentor_profiles_pkey` CI flake at its
-- root.
--
-- THE FLAKE. Test fixtures that do a bare `insert into mentor_profiles` for a
-- pooled user (0188 / tests/support/auth.ts) intermittently failed with
-- `duplicate key value violates unique constraint "mentor_profiles_pkey"`. It
-- hit reviewer-claim-race.test.ts (#562), dual-role-isolation.test.ts (#563)
-- and display-name.test.ts (PR #572's CI) in a single day; ~20 test files carry
-- the same bare insert, so patching them one at a time was never going to end.
--
-- THE CAUSE (verified against the live FK graph, not assumed). 0188's
-- reset_test_pool_user deleted `mentor_profiles` first in its table list — a
-- delete blocked by three NO ACTION, NOT NULL foreign keys
-- (mentorship_sessions.mentor_id, mentorship_reviews.mentor_id,
-- mentor_payouts.mentor_id) — then only cleared mentorship_sessions where the
-- user was the MENTEE, never where they were the mentor, and never cleared
-- mentor_payouts at all. Its header called the residual "accepted" on the
-- reasoning that those FKs "cannot be resolved this way". They can: delete
-- child-first (payouts, reviews, sessions), after which mentor_profiles and
-- its slots delete cleanly. The blocked delete was swallowed by the loop's
-- foreign_key_violation handler, so the residual was silent until a later
-- test collided on it.
--
-- WHAT THIS CHANGES. Only the body of reset_test_pool_user, and only by adding
-- the child-first clears above the existing loop. Table list, profiles reset,
-- email_preferences reset, signature and grants are untouched (create or
-- replace keeps the ACL from 0188). Scope is unchanged: it acts on ONE pooled
-- test identity handed in by claim_test_pool_user, service-role only. It does
-- not touch the mentor on the other side of a mentee's session, nor that
-- mentor's other sessions — pinned by
-- tests/support/test-user-pool-mentor-reset.test.ts.
--
-- ADDITIVE (behavioural, function body only): safe to apply before merging.

create or replace function public.reset_test_pool_user(p_user_id uuid, p_new_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- `mentor_profiles` (in the table loop below) is blocked by rows in OTHER
  -- tables that reference it with NO ACTION and NOT NULL, so a pooled user
  -- that ever ran a real mentor session kept its mentor_profiles row across
  -- reuse, and the next claimant's bare `insert into mentor_profiles`
  -- collided on mentor_profiles_pkey (0201 — this is the root cause of that
  -- recurring CI flake; the earlier note here that these FKs "cannot be
  -- resolved this way" was wrong: they can, they just have to be deleted
  -- child-first). The blockers and their order:
  --   mentor_payouts.mentor_id / .session_id  (NO ACTION)
  --   mentorship_reviews.mentor_id            (NO ACTION; .session_id cascades)
  --   mentorship_sessions.mentor_id           (NO ACTION), and
  --     mentorship_sessions.availability_slot_id -> mentor_availability_slots
  --     (NO ACTION), which is what stops mentor_profiles' cascade to its slots
  --     while sessions still exist
  -- Each statement is its own guarded block: same "report, don't abort"
  -- stance as the loop below, and one failing must not roll back the others
  -- (a plpgsql exception block rolls back everything inside it).
  --
  -- As a MENTOR: payouts, then reviews, then sessions (mentor_profiles
  -- itself, and its slots, then delete cleanly in the loop below).
  begin
    delete from public.mentor_payouts where mentor_id = p_user_id;
  exception when foreign_key_violation then
    raise warning 'reset_test_pool_user: mentor_payouts (as mentor) blocked for %: %', p_user_id, sqlerrm;
  end;
  begin
    delete from public.mentorship_reviews where mentor_id = p_user_id;
  exception when foreign_key_violation then
    raise warning 'reset_test_pool_user: mentorship_reviews (as mentor) blocked for %: %', p_user_id, sqlerrm;
  end;
  begin
    delete from public.mentorship_sessions where mentor_id = p_user_id;
  exception when foreign_key_violation then
    raise warning 'reset_test_pool_user: mentorship_sessions (as mentor) blocked for %: %', p_user_id, sqlerrm;
  end;
  -- As a MENTEE: a payout belongs to the mentor but points at this user's
  -- session, and blocks the mentee_id delete in the loop below. Only THIS
  -- user's sessions are touched — the mentor's own row and their other
  -- sessions are deliberately left alone (a reset is one identity, not a wipe).
  begin
    delete from public.mentor_payouts
      where session_id in (select id from public.mentorship_sessions where mentee_id = p_user_id);
  exception when foreign_key_violation then
    raise warning 'reset_test_pool_user: mentor_payouts (as mentee) blocked for %: %', p_user_id, sqlerrm;
  end;

  -- talent_verifications.reviewer_id is the one nullable blocker, so it is
  -- nulled rather than deleted.
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
