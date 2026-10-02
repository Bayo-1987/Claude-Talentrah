-- ROLLBACK for 0212 (account deletion, PR 1). Not a migration: it is the exact undo, kept beside the file it undoes so it is reviewed in the same diff
-- and so nobody has to reconstruct it under pressure. Run it as `postgres` in the SQL Editor, in ONE transaction (it is written to be). To keep what the
-- schema ledger says honest, record it as a NEW migration (do not delete 0212's ledger row).
--
-- ORDER MATTERS and is the reason this is a file: first every function and policy 0212 rewrote goes back to its previous body (so nothing refers to
-- the flag or the helper any more), then the new functions go, then the table and the column.
--
-- WHAT IT DESTROYS: the `account_deletions` table (every deletion request on record) and the `profiles.deletion_requested_at` flag. If anyone has
-- confirmed a deletion, that person's account stops being hidden the moment this runs and their Auto-Apply and Pass renewal stay cancelled. Check
-- `select count(*) from public.account_deletions where status = 'scheduled'` first; if it is not zero, decide what to do about them before running.
--
-- PROVEN, not assumed: in one rolled-back transaction against the live catalogue, the definitions captured before 0212 are compared with the ones after
-- 0212 + this file, and must be identical (the output is in the PR body). Note that production's bodies and talentrah-preview's differ in places (comments),
-- so the proof that matters is the one against production.

begin;

-- 1. The rewritten functions and policies, back to their bodies from before 0212 ---------------------------------------------------------------------------------------------------------------
-- listed_ids is where the count, the free preview, the paid search and the pool for the preview all start, so one added predicate hides a person from
-- all of them at once.
create or replace function public.talent_directory_listed_ids()
 returns setof uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.id
  from public.profiles p
  where p.talent_directory_opt_in = true
    and p.talent_verification_status = 'verified'
$function$;

create or replace function public.talent_directory_portfolio_items(p_candidate_id uuid)
 returns table(id uuid, title text, description text, url text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not exists (
    select 1
    from public.organization_members om
    join public.talent_directory_subscriptions s on s.organization_id = om.organization_id
    where om.user_id = auth.uid()
      and s.status = 'active'
      and s.expires_at > now()
  ) then
    return;
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_candidate_id
      and p.talent_directory_opt_in = true
      and p.talent_verification_status = 'verified'
  ) then
    return;
  end if;

  return query
    select i.id, i.title, i.description, i.url
    from public.talent_portfolio_items i
    where i.user_id = p_candidate_id
    order by i.created_at;
end;
$function$;

create or replace function public.request_talent_directory_contact(p_organization_id uuid, p_candidate_id uuid, p_message text, p_requested_by uuid)
 returns table(ok boolean, reason text, request_id uuid)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_org_active boolean;
  v_candidate_eligible boolean;
  v_new_id uuid;
  v_limit record;
  v_message text;
begin
  select exists (
    select 1
    from public.talent_directory_subscriptions s
    where s.organization_id = p_organization_id
      and s.status = 'active'
      and s.expires_at > now()
  ) into v_org_active;

  if not v_org_active then
    return query select false, 'not_subscribed'::text, null::uuid; return;
  end if;

  select exists (
    select 1 from public.profiles p
    where p.id = p_candidate_id
      and p.talent_directory_opt_in = true
      and p.talent_verification_status = 'verified'
  ) into v_candidate_eligible;

  if not v_candidate_eligible then
    return query select false, 'candidate_not_listed'::text, null::uuid; return;
  end if;

  v_message := btrim(coalesce(p_message, ''));
  if v_message = '' then
    return query select false, 'message_required'::text, null::uuid; return;
  end if;

  select * into v_limit
  from public.consume_anonymous_rate_limit(p_organization_id::text, 'talent_directory_contact', 20, 86400);

  if not v_limit.allowed then
    return query select false, 'rate_limited'::text, null::uuid; return;
  end if;

  insert into public.talent_directory_contact_requests (organization_id, candidate_id, requested_by, message)
  values (p_organization_id, p_candidate_id, p_requested_by, v_message)
  returning id into v_new_id;

  return query select true, 'ok'::text, v_new_id;
exception
  when unique_violation then
    return query select false, 'already_pending'::text, null::uuid;
end;
$function$;

create or replace function public.employer_job_applicants(p_job_posting_id uuid)
 returns table(application_id uuid, first_name text, last_name text, applied_at timestamp with time zone, resume_id uuid, status public.applicant_review_status, match_score integer, match_tier text, matched_skills jsonb, missing_skills jsonb, seniority_alignment text, talent_verification_status text, talent_verification_score integer, screening_passed boolean)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select
    a.id,
    p.first_name,
    p.last_name,
    a.applied_at,
    a.resume_id,
    coalesce(s.status, 'new'::public.applicant_review_status),
    m.score,
    m.tier,
    m.explanation -> 'matchedSkills',
    m.explanation -> 'missingSkills',
    m.explanation ->> 'seniorityAlignment',
    p.talent_verification_status,
    p.talent_verification_score,
    a.screening_passed
  from public.applications a
  join public.job_postings j on j.id = a.job_posting_id
  join public.profiles p on p.id = a.user_id
  left join public.employer_applicant_status s on s.application_id = a.id
  left join public.match_scores m on m.user_id = a.user_id and m.job_posting_id = a.job_posting_id
  where a.job_posting_id = p_job_posting_id
    and public.is_org_member(j.organization_id)
    and a.applied_at is not null
  order by m.score desc nulls last, a.applied_at desc;
$function$;

create or replace function public.employer_application_screening_answers(p_application_id uuid)
 returns table(question_text text, question_type text, required boolean, screening_mode text, answer_yes_no boolean, answer_number numeric, answer_text text, passed boolean, farah_review_status text, farah_tier text, farah_summary text)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select
    q.question_text,
    q.question_type,
    q.required,
    q.screening_mode,
    a.answer_yes_no,
    a.answer_number,
    a.answer_text,
    a.passed,
    a.farah_review_status,
    a.farah_tier,
    a.farah_summary
  from public.applications app
  join public.job_postings j on j.id = app.job_posting_id
  join public.job_posting_screening_questions q on q.job_posting_id = app.job_posting_id
  left join public.application_screening_answers a
    on a.question_id = q.id and a.application_id = app.id
  where app.id = p_application_id
    and public.is_org_member(j.organization_id)
  order by q.sort_order;
$function$;

create or replace function public.employer_resume_view_context(p_application_id uuid)
 returns table(seeker_id uuid, job_title text, company_name text)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select a.user_id, j.title, j.company_name
  from public.applications a
  join public.job_postings j on j.id = a.job_posting_id
  where a.id = p_application_id
    and public.is_org_member_for_application(p_application_id);
$function$;

create or replace function public.employer_view_resume(p_application_id uuid)
 returns table(structured_content jsonb, template_slug text)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select r.structured_content, rt.slug
  from public.applications a
  join public.job_postings j on j.id = a.job_posting_id
  join public.resumes r on r.id = a.resume_id
  left join public.resume_templates rt on rt.id = r.template_id
  where a.id = p_application_id
    and public.is_org_member(j.organization_id);
$function$;

create or replace function public.record_employer_resume_view(p_application_id uuid)
 returns boolean
 language sql
 security definer
 set search_path to ''
as $function$
  with existing as (
    select first_viewed_at
    from public.employer_applicant_status
    where application_id = p_application_id
  ),
  upserted as (
    insert into public.employer_applicant_status (application_id, first_viewed_at)
    select p_application_id, now()
    where public.is_org_member_for_application(p_application_id)
    on conflict (application_id) do update
      set first_viewed_at = coalesce(
        public.employer_applicant_status.first_viewed_at,
        excluded.first_viewed_at
      )
    returning 1
  )
  select exists (select 1 from upserted)
     and not exists (select 1 from existing where first_viewed_at is not null);
$function$;

create or replace function public.org_application_counts(p_organization_id uuid)
 returns table(job_posting_id uuid, application_count bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select a.job_posting_id, count(*)::bigint
  from public.applications a
  join public.job_postings j on j.id = a.job_posting_id
  where j.organization_id = p_organization_id
    and j.source_type = 'internal'
    and public.is_org_member(p_organization_id)
  group by a.job_posting_id;
$function$;

-- The applicant's own access to their own upload is untouched; only the employer branch learns about the flag.
create or replace function public.can_access_assessment_submission(p_object_path text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1
    from public.application_assessment_response_files f
    join public.application_assessment_submissions s on s.id = f.application_assessment_submission_id
    join public.applications a on a.id = s.application_id
    where f.file_path = p_object_path
      and (
        a.user_id = (select auth.uid())
        or public.is_org_member(f.organization_id)
      )
  );
$function$;

create or replace function public.referral_leaderboard(p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_limit integer default 20)
 returns table(rank integer, display_name text, activated_count integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    (row_number() over (order by count(*) desc, min(r.activated_at) asc))::int as rank,
    coalesce(nullif(trim(p.referral_leaderboard_display_name), ''), p.first_name, 'A Talentrah member') as display_name,
    count(*)::int as activated_count
  from public.referrals r
  join public.profiles p on p.id = r.referrer_id
  where r.status = 'activated'
    and r.activated_at >= p_period_start
    and r.activated_at < p_period_end
    and p.referral_leaderboard_opt_in = true
  group by p.id, p.referral_leaderboard_display_name, p.first_name
  order by count(*) desc, min(r.activated_at) asc
  limit p_limit;
$function$;

-- The two SELECT policies back to their previous expressions, by current name (as the migration found them).
do $$
declare
  v_name text;
begin
  select policyname into v_name from pg_policies
   where schemaname = 'public' and tablename = 'mentor_profiles' and cmd = 'SELECT' and policyname like 'mentor profiles are approved-and-public%';
  if v_name is null then raise exception 'rollback 0212: the mentor_profiles SELECT policy was not found'; end if;
  execute format(
    'alter policy %I on public.mentor_profiles using ((((status = ''approved'') and (not self_paused)) or (user_id = (select auth.uid()))))',
    v_name);

  select policyname into v_name from pg_policies
   where schemaname = 'public' and tablename = 'mentor_availability_slots' and cmd = 'SELECT' and policyname like 'availability is visible for approved mentors%';
  if v_name is null then raise exception 'rollback 0212: the mentor_availability_slots SELECT policy was not found'; end if;
  execute format(
    'alter policy %I on public.mentor_availability_slots using (((mentor_id = (select auth.uid())) or exists (select 1 from public.mentor_profiles mp where mp.user_id = mentor_availability_slots.mentor_id and mp.status = ''approved'' and not mp.self_paused)))',
    v_name);
end $$;

create or replace function public.open_mentor_slots(p_mentor_ids uuid[], p_now timestamp with time zone default now())
 returns table(id uuid, mentor_id uuid, start_at timestamp with time zone, end_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select s.id, s.mentor_id, s.start_at, s.end_at
    from public.mentor_availability_slots s
    join public.mentor_profiles m
      on m.user_id = s.mentor_id and m.status = 'approved' and not m.self_paused
   where s.mentor_id = any (p_mentor_ids)
     and s.start_at > p_now
     and (
       not s.is_booked
       or exists (
         select 1 from public.mentorship_sessions x
          where x.availability_slot_id = s.id
            and x.status = 'pending_payment'
            and x.created_at <= p_now - public.mentor_unpaid_hold()
       )
     )
   order by s.start_at;
$function$;

create or replace function public.mentor_public_names(p_mentor_ids uuid[])
 returns table(user_id uuid, first_name text, last_name text, display_name text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  return query
    select p.id, p.first_name, p.last_name, mp.display_name
    from public.profiles p
    join public.mentor_profiles mp on mp.user_id = p.id
    where p.id = any(p_mentor_ids)
      and mp.status = 'approved'
      and not mp.self_paused;
end;
$function$;

create or replace function public.book_mentor_session(p_availability_slot_id uuid, p_mentee_id uuid, p_session_type text)
 returns table(session_id uuid, price_ngn integer, mentor_id uuid)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_mentor_id uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_base_price integer;
  v_mentor_status text;
  v_mentor_self_paused boolean;
  v_price integer;
  v_commission integer;
  v_payout integer;
  v_session_id uuid;
begin
  if p_session_type not in ('resume_review', 'mock_interview', 'career_strategy', 'negotiation_strategy', 'quick_question') then
    raise exception 'INVALID_SESSION_TYPE';
  end if;

  -- `mentor_availability_slots.mentor_id` is qualified, deliberately: this function's own `returns table (..., mentor_id uuid)`
  -- declares a PL/pgSQL variable of that name, so a bare `mentor_id` in RETURNING is ambiguous (42702). See 0174.
  with stale as (
    update public.mentorship_sessions
       set status = 'expired_unpaid', updated_at = now()
     where availability_slot_id = p_availability_slot_id
       and status = 'pending_payment'
       and created_at <= now() - public.mentor_unpaid_hold()
    returning id
  )
  update public.mentor_availability_slots
     set is_booked = true
   where id = p_availability_slot_id
     and (is_booked = false or exists (select 1 from stale))
  returning mentor_availability_slots.mentor_id, start_at, end_at into v_mentor_id, v_start, v_end;

  if v_mentor_id is null then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  -- A mentor cannot book their own listing as a mentee (see 0174 / tests/mentorship/dual-role-isolation.test.ts).
  if p_mentee_id = v_mentor_id then
    raise exception 'CANNOT_BOOK_OWN_LISTING';
  end if;

  select status, self_paused, base_price_ngn into v_mentor_status, v_mentor_self_paused, v_base_price
  from public.mentor_profiles where user_id = v_mentor_id;

  if v_mentor_status is distinct from 'approved' then
    raise exception 'MENTOR_NOT_APPROVED';
  end if;

  if v_mentor_self_paused then
    raise exception 'MENTOR_PAUSED';
  end if;

  v_price := case
    when v_base_price is null then 0
    when p_session_type = 'quick_question' then 6000
    when p_session_type in ('mock_interview', 'negotiation_strategy') then round(v_base_price * 1.25)
    else v_base_price
  end;
  v_commission := round(v_price * 0.15);
  v_payout := v_price - v_commission;

  insert into public.mentorship_sessions (
    mentor_id, mentee_id, availability_slot_id, session_type,
    scheduled_start, scheduled_end, price_ngn, platform_commission_ngn, mentor_payout_ngn,
    status
  ) values (
    v_mentor_id, p_mentee_id, p_availability_slot_id, p_session_type,
    v_start, v_end, v_price, v_commission, v_payout,
    case when v_price = 0 then 'awaiting_confirmation' else 'pending_payment' end
  ) returning id into v_session_id;

  return query select v_session_id, v_price, v_mentor_id;
end;
$function$;

-- 2. The test-user pool reset, back to 0201's body
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

-- 3. The new objects, now that nothing refers to them
drop function if exists public.account_deletion_restore();
drop function if exists public.account_deletion_status();
drop function if exists public.account_deletion_confirm(uuid, text);
drop function if exists public.account_deletion_create_request(uuid, text);
drop function if exists public.account_deletion_blockers(uuid);
drop function if exists public.account_is_active(uuid);
drop table if exists public.account_deletions;
alter table public.profiles drop column if exists deletion_requested_at;

commit;
