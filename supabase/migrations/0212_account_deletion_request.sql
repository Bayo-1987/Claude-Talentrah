-- 0212: account deletion, part 1 (ACCT-1 PR 1): request, emailed confirm link, hide immediately, stop mail and money.
--
-- WHAT THIS DOES. A signed-in user can ask to delete their account. The request is confirmed from an emailed, single-use link that expires in one
-- hour and works only for the same user's session. Confirming schedules the hard delete 30 days out (a later PR runs it) and, in the same
-- transaction: hides the account from every surface other people read it through, cancels Auto-Apply, cancels Pass auto-renewal, and (for a
-- person who is the only member of an organisation) closes that organisation's open postings and pauses its running campaigns. Signing in again
-- inside the 30 days offers "restore it, or keep the deletion"; restoring is one call and never silent.
--
-- THE FLAG IS THE SINGLE SOURCE. `profiles.deletion_requested_at` is set only inside account_deletion_confirm() and cleared only inside
-- account_deletion_restore(). It carries no UPDATE grant for any client (grants on `profiles` are column lists, CLAUDE.md), so a signed-in user
-- cannot clear it with a direct PATCH. Every hiding rule below reads this one column.
--
-- WHAT IS HIDDEN, AND WHERE (the read surfaces other people use to see a person):
--   Talent Directory     talent_directory_listed_ids() (the one place the count, the preview, the paid search and the portfolio all start
--                        from), talent_directory_portfolio_items(), request_talent_directory_contact()
--   Employer applicants  employer_job_applicants(), employer_application_screening_answers(), employer_view_resume(),
--                        employer_resume_view_context(), record_employer_resume_view(), org_application_counts(), and the employer branch
--                        of can_access_assessment_submission() (the applicant's own access is untouched)
--   Mentor discovery     the SELECT policies on mentor_profiles and mentor_availability_slots, open_mentor_slots(), mentor_public_names(),
--                        and book_mentor_session() (a departing mentor cannot be booked)
--   Referral leaderboard referral_leaderboard()
-- Each is a `create or replace` of the CURRENT body (read from production's catalog, then diffed) with one added predicate, so grants and
-- ownership are kept as they are.
--
-- WHAT IS NOT CHANGED HERE. Nothing is deleted or anonymised: the 30-day purge, the export, and the anonymisation of money tables (0209 already
-- made those FKs SET NULL) are later PRs. Unused credits are only RECORDED as forfeited (account_deletions.credits_forfeited, informational);
-- the balance stays until the purge so a restore gives it all back. The refund_policy and refund_note columns are nullable and unused today, so
-- a refund policy can be added later with no migration.
--
-- WHO MAY CALL WHAT. account_deletion_blockers / _create_request / _confirm are service-role only: they take the user id as an argument, so
-- they are never callable with a client's own token, and the Server Action takes that id from the verified session. account_deletion_restore
-- and account_deletion_status are the only ones a signed-in user can call, and they act on auth.uid() alone. account_is_active is executable by
-- authenticated (RLS policies call it) and not by anon.
--
-- ADDITIVE for the running app (a nullable column, a new table, new functions, and added predicates that are all true while the column is
-- null), so it is applied to production BEFORE the merge, after a rolled-back dry run and the owner's yes.

-- 1. The flag ---------------------------------------------------------------------------------------------------------------------------
alter table public.profiles add column if not exists deletion_requested_at timestamptz;
comment on column public.profiles.deletion_requested_at is
  'Set when the owner confirms account deletion (account_deletion_confirm), cleared on restore. Not null = hidden from every other-people surface, mail suppressed. No client UPDATE grant.';

-- 2. The request record --------------------------------------------------------------------------------------------------------------------
create table if not exists public.account_deletions (
  id                uuid primary key default gen_random_uuid(),
  -- Deliberately NO foreign key: this record must outlive the profile it describes (it is the audit trail that the deletion was asked for,
  -- confirmed and carried out), and a cascading FK would erase it with the account.
  profile_id        uuid not null,
  status            text not null default 'pending_confirmation'
                    check (status in ('pending_confirmation', 'scheduled', 'restored', 'superseded', 'purged')),
  -- sha256 (hex) of the emailed token. The token itself is never stored, so a database read cannot be turned into a confirm link.
  token_hash        text not null,
  token_expires_at  timestamptz not null,
  requested_at      timestamptz not null default now(),
  confirmed_at      timestamptz,
  hard_delete_after timestamptz,
  restored_at       timestamptz,
  -- Informational: the balance at the moment of confirming. The balance itself is untouched until the purge.
  credits_forfeited integer check (credits_forfeited is null or credits_forfeited >= 0),
  -- Unused today. Present so a refund policy can be added later without a migration.
  refund_policy     text,
  refund_note       text
);

create unique index if not exists account_deletions_token_hash_key on public.account_deletions (token_hash);
create index if not exists account_deletions_profile_status_idx on public.account_deletions (profile_id, status);
create index if not exists account_deletions_due_idx on public.account_deletions (hard_delete_after) where status = 'scheduled';

alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from anon, authenticated;
comment on table public.account_deletions is
  'ACCT-1: one row per deletion request. Service-role and SECURITY DEFINER functions only (no policies, no grants). profile_id has no FK on purpose: the record outlives the profile.';

-- 3. The one predicate other policies and functions use -------------------------------------------------------------------------------------
create or replace function public.account_is_active(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.profiles p where p.id = p_user_id and p.deletion_requested_at is not null
  );
$$;
revoke execute on function public.account_is_active(uuid) from public, anon;
grant execute on function public.account_is_active(uuid) to authenticated, service_role;

-- 4. What stops, or must be dealt with first ---------------------------------------------------------------------------------------------
-- One read, used both to show the person why (Settings) and, again, inside the confirm transaction, so the answer that gates the deletion is the
-- one read under the same lock and not a stale one from when the page rendered.
create or replace function public.account_deletion_blockers(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sessions   jsonb;
  v_payouts    jsonb;
  v_org_shared jsonb;
  v_close      jsonb;
  v_campaigns  integer;
begin
  -- Paid mentorship that has not happened yet, on either side. A confirmed or awaiting-confirmation session with a price is money held for a
  -- session; deleting either party strands it.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id,
           'role', case when s.mentor_id = p_user_id then 'mentor' else 'mentee' end,
           'session_type', s.session_type,
           'scheduled_start', s.scheduled_start,
           'status', s.status
         ) order by s.scheduled_start), '[]'::jsonb)
    into v_sessions
  from public.mentorship_sessions s
  where (s.mentor_id = p_user_id or s.mentee_id = p_user_id)
    and s.price_ngn > 0
    and s.status in ('awaiting_confirmation', 'confirmed')
    and s.scheduled_end > now();

  -- A mentor is owed money until the payout is paid. Deleting the mentor would leave a payout nobody can receive.
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'amount_ngn', m.amount_ngn, 'status', m.status) order by m.created_at), '[]'::jsonb)
    into v_payouts
  from public.mentor_payouts m
  where m.mentor_id = p_user_id and m.status <> 'paid';

  -- An organisation the person owns that other people also belong to: ownership has to be handed over first (there is no hand-over flow yet,
  -- so this reads as "contact us"; with no multi-member organisations in production it blocks nobody today).
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.name), '[]'::jsonb)
    into v_org_shared
  from public.organization_members om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = p_user_id
    and (om.role = 'owner' or o.created_by = p_user_id)
    and exists (select 1 from public.organization_members x where x.organization_id = o.id and x.user_id <> p_user_id);

  -- An organisation with nobody else in it: not a block. Its open postings are closed in the confirm step and the person is shown the list.
  select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'title', j.title, 'organization', o.name) order by o.name, j.title), '[]'::jsonb)
    into v_close
  from public.organization_members om
  join public.organizations o on o.id = om.organization_id
  join public.job_postings j on j.organization_id = o.id and j.status = 'open'
  where om.user_id = p_user_id
    and not exists (select 1 from public.organization_members x where x.organization_id = o.id and x.user_id <> p_user_id);

  select count(*)::integer into v_campaigns
  from public.organization_members om
  join public.ad_campaigns c on c.organization_id = om.organization_id and c.status = 'active'
  where om.user_id = p_user_id
    and not exists (select 1 from public.organization_members x where x.organization_id = om.organization_id and x.user_id <> p_user_id);

  return jsonb_build_object(
    'mentorship_sessions', v_sessions,
    'mentor_payouts', v_payouts,
    'organisations_with_other_members', v_org_shared,
    'postings_to_close', v_close,
    'campaigns_to_pause', v_campaigns,
    'blocked', (jsonb_array_length(v_sessions) > 0 or jsonb_array_length(v_payouts) > 0 or jsonb_array_length(v_org_shared) > 0)
  );
end;
$$;
revoke execute on function public.account_deletion_blockers(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_blockers(uuid) to service_role;

-- 5. Ask: store the hash of an emailed token ------------------------------------------------------------------------------------------------
create or replace function public.account_deletion_create_request(p_user_id uuid, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_blockers jsonb;
  v_recent integer;
  v_expires timestamptz;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;
  if v_profile.deletion_requested_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_scheduled');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_token');
  end if;

  -- Not worth emailing someone who cannot proceed: say why instead.
  v_blockers := public.account_deletion_blockers(p_user_id);
  if (v_blockers ->> 'blocked')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'blocked', 'blockers', v_blockers);
  end if;

  -- Three emails an hour is plenty; more is a way to fill someone's inbox.
  select count(*) into v_recent from public.account_deletions
   where profile_id = p_user_id and requested_at > now() - interval '1 hour';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- A new request replaces any earlier unconfirmed one, so only the newest link in an inbox works.
  update public.account_deletions set status = 'superseded'
   where profile_id = p_user_id and status = 'pending_confirmation';

  v_expires := now() + interval '1 hour';
  insert into public.account_deletions (profile_id, token_hash, token_expires_at)
  values (p_user_id, p_token_hash, v_expires);

  return jsonb_build_object('ok', true, 'expires_at', v_expires, 'blockers', v_blockers);
end;
$$;
revoke execute on function public.account_deletion_create_request(uuid, text) from public, anon, authenticated;
grant execute on function public.account_deletion_create_request(uuid, text) to service_role;

-- 6. Confirm: single use, one hour, this user only, everything in one transaction ---------------------------------------------------------------
create or replace function public.account_deletion_confirm(p_user_id uuid, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.account_deletions%rowtype;
  v_profile public.profiles%rowtype;
  v_blockers jsonb;
  v_titles jsonb;
  v_hard_delete timestamptz;
  v_sole_orgs uuid[];
begin
  -- The row is found by token AND by owner, and locked: two clicks race for the same row and exactly one finds it still pending.
  select * into v_row from public.account_deletions
   where token_hash = p_token_hash and profile_id = p_user_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_row.status <> 'pending_confirmation' then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  if v_row.token_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_profile.deletion_requested_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_scheduled');
  end if;

  v_blockers := public.account_deletion_blockers(p_user_id);
  if (v_blockers ->> 'blocked')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'blocked', 'blockers', v_blockers);
  end if;

  v_hard_delete := now() + interval '30 days';

  -- Consume the token and schedule, first, so a failure in any later step rolls the whole confirm back and the link still works.
  update public.account_deletions
     set status = 'scheduled', confirmed_at = now(), hard_delete_after = v_hard_delete, credits_forfeited = greatest(v_profile.credits_balance, 0)
   where id = v_row.id;

  -- Hide: the one flag every surface reads.
  update public.profiles set deletion_requested_at = now(), updated_at = now() where id = p_user_id;

  -- Stop Auto-Apply: the switch, and anything waiting for the person to review.
  update public.auto_apply_settings set enabled = false, updated_at = now() where user_id = p_user_id and enabled;
  update public.auto_apply_queue set status = 'dismissed', decided_at = now() where user_id = p_user_id and status = 'pending';

  -- Stop Pass renewal: the same four-column cancel the Billing page's own "cancel auto-renewal" performs (cancelPassAutoRenewal), including
  -- dropping the stored card authorisation. Access to a Pass already paid for is untouched.
  update public.user_passes
     set auto_renew = false, auto_renew_status = 'canceled', next_renewal_date = null, authorization_code = null
   where user_id = p_user_id and auto_renew_status = 'active';

  -- A person who is the only member of an organisation: close its open postings (the list was shown to them) and pause what is spending money.
  -- The organisation, its postings and the applications on them are kept; they are other people's records too. Applicants are not emailed: they
  -- see the ordinary closed state.
  select coalesce(array_agg(om.organization_id), '{}'::uuid[]) into v_sole_orgs
  from public.organization_members om
  where om.user_id = p_user_id
    and not exists (select 1 from public.organization_members x where x.organization_id = om.organization_id and x.user_id <> p_user_id);

  update public.job_postings set status = 'closed', closed_at = now()
   where organization_id = any (v_sole_orgs) and status = 'open';
  update public.ad_campaigns set status = 'paused_by_employer', updated_at = now()
   where organization_id = any (v_sole_orgs) and status = 'active';

  v_titles := v_blockers -> 'postings_to_close';

  return jsonb_build_object(
    'ok', true,
    'hard_delete_after', v_hard_delete,
    'credits_forfeited', greatest(v_profile.credits_balance, 0),
    'closed_postings', v_titles
  );
end;
$$;
revoke execute on function public.account_deletion_confirm(uuid, text) from public, anon, authenticated;
grant execute on function public.account_deletion_confirm(uuid, text) to service_role;

-- 7. A signed-in user's own two calls ------------------------------------------------------------------------------------------------------
create or replace function public.account_deletion_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('scheduled', true, 'hard_delete_after', d.hard_delete_after, 'credits_forfeited', d.credits_forfeited)
       from public.account_deletions d
      where d.profile_id = (select auth.uid()) and d.status = 'scheduled'
      order by d.confirmed_at desc
      limit 1),
    jsonb_build_object('scheduled', false)
  );
$$;
revoke execute on function public.account_deletion_status() from public, anon;
grant execute on function public.account_deletion_status() to authenticated, service_role;

-- Restore, on the person's choice. It puts back exactly one thing: visibility. Auto-Apply stays off, Pass renewal stays cancelled and the
-- postings closed at confirm stay closed (each is one click to turn back on), because none of those is something to switch on for someone who
-- only came back to look.
create or replace function public.account_deletion_restore()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.account_deletions%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;
  select * into v_row from public.account_deletions
   where profile_id = v_uid and status = 'scheduled'
   order by confirmed_at desc limit 1 for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_restore');
  end if;
  if v_row.hard_delete_after <= now() then
    return jsonb_build_object('ok', false, 'reason', 'window_closed');
  end if;
  update public.profiles set deletion_requested_at = null, updated_at = now() where id = v_uid;
  update public.account_deletions set status = 'restored', restored_at = now() where id = v_row.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.account_deletion_restore() from public, anon;
grant execute on function public.account_deletion_restore() to authenticated, service_role;

-- 8. Hide: the Talent Directory ---------------------------------------------------------------------------------------------------------------
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
    and p.deletion_requested_at is null
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
      and p.deletion_requested_at is null
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
      and p.deletion_requested_at is null
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

-- 9. Hide: employers' applicant views ----------------------------------------------------------------------------------------------------------
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
    and p.deletion_requested_at is null
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
    and public.account_is_active(app.user_id)
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
    and public.is_org_member_for_application(p_application_id)
    and public.account_is_active(a.user_id);
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
    and public.is_org_member(j.organization_id)
    and public.account_is_active(a.user_id);
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
      and exists (
        select 1 from public.applications a
        where a.id = p_application_id and public.account_is_active(a.user_id)
      )
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
    and public.account_is_active(a.user_id)
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
        or (public.is_org_member(f.organization_id) and public.account_is_active(a.user_id))
      )
  );
$function$;

-- 10. Hide: the referral leaderboard -------------------------------------------------------------------------------------------------------------
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
    and p.deletion_requested_at is null
  group by p.id, p.referral_leaderboard_display_name, p.first_name
  order by count(*) desc, min(r.activated_at) asc
  limit p_limit;
$function$;

-- 11. Hide: mentor discovery -------------------------------------------------------------------------------------------------------------------
-- The two SELECT policies are altered by their own current name rather than dropped and recreated: Postgres truncates long policy names to 63
-- bytes and one of these ends in a space, so the name is read from pg_policies instead of being retyped.
do $$
declare
  v_name text;
begin
  select policyname into v_name from pg_policies
   where schemaname = 'public' and tablename = 'mentor_profiles' and cmd = 'SELECT' and policyname like 'mentor profiles are approved-and-public%';
  if v_name is null then raise exception '0212: the mentor_profiles SELECT policy was not found'; end if;
  execute format(
    'alter policy %I on public.mentor_profiles using (((status = ''approved'' and not self_paused and public.account_is_active(user_id)) or user_id = (select auth.uid())))',
    v_name);

  select policyname into v_name from pg_policies
   where schemaname = 'public' and tablename = 'mentor_availability_slots' and cmd = 'SELECT' and policyname like 'availability is visible for approved mentors%';
  if v_name is null then raise exception '0212: the mentor_availability_slots SELECT policy was not found'; end if;
  execute format(
    'alter policy %I on public.mentor_availability_slots using ((mentor_id = (select auth.uid()) or exists (select 1 from public.mentor_profiles mp where mp.user_id = mentor_availability_slots.mentor_id and mp.status = ''approved'' and not mp.self_paused and public.account_is_active(mp.user_id))))',
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
      on m.user_id = s.mentor_id and m.status = 'approved' and not m.self_paused and public.account_is_active(m.user_id)
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
      and not mp.self_paused
      and p.deletion_requested_at is null;
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

  -- 0212: a mentor whose account is scheduled for deletion cannot be booked. Raised after the slot update above, so the exception rolls
  -- that update back with everything else.
  if not public.account_is_active(v_mentor_id) then
    raise exception 'MENTOR_NOT_APPROVED';
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

-- 12. The test-user pool must hand out a clean identity -------------------------------------------------------------------------------------------
-- Same body as 0201's reset_test_pool_user, plus two lines (marked 0212). create or replace keeps the ACL 0188 set (service-role only).
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

  -- 0212: a pooled identity that was ever put through account deletion starts clean. account_deletions has no FK to profiles (the record
  -- outlives the account), so nothing cascades it; and the flag itself is cleared in the profiles reset below.
  delete from public.account_deletions where profile_id = p_user_id;

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
    deletion_requested_at = null,
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

-- 13. Self-check: the migration fails (and rolls back) unless every piece took effect ---------------------------------------------------------------
do $$
declare
  fn text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'deletion_requested_at') then
    raise exception 'self-check: profiles.deletion_requested_at is missing';
  end if;
  if has_table_privilege('authenticated', 'public.account_deletions', 'select') or has_table_privilege('anon', 'public.account_deletions', 'select') then
    raise exception 'self-check: account_deletions is readable by a client role';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'deletion_requested_at', 'update') then
    raise exception 'self-check: a signed-in user can UPDATE profiles.deletion_requested_at';
  end if;
  foreach fn in array array[
    'public.account_deletion_blockers(uuid)',
    'public.account_deletion_create_request(uuid, text)',
    'public.account_deletion_confirm(uuid, text)'
  ] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'self-check: % is callable by a client role', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception 'self-check: % is not callable by service_role', fn;
    end if;
  end loop;
  foreach fn in array array['public.account_deletion_status()', 'public.account_deletion_restore()'] loop
    if has_function_privilege('anon', fn, 'execute') then
      raise exception 'self-check: % is callable by anon', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'self-check: % is not callable by authenticated', fn;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.account_is_active(uuid)', 'execute') then
    raise exception 'self-check: account_is_active is callable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.account_is_active(uuid)', 'execute') then
    raise exception 'self-check: account_is_active is not callable by authenticated (RLS policies call it)';
  end if;
  -- Every function this migration rewrote still has the grants it had: spot-check the three that anon must never gain, and the two that
  -- signed-in users must keep.
  if has_function_privilege('anon', 'public.employer_job_applicants(uuid)', 'execute') then
    raise exception 'self-check: employer_job_applicants gained anon execute';
  end if;
  if has_function_privilege('anon', 'public.referral_leaderboard(timestamptz, timestamptz, integer)', 'execute') then
    raise exception 'self-check: referral_leaderboard gained anon execute (0211 removed it)';
  end if;
  if not has_function_privilege('authenticated', 'public.open_mentor_slots(uuid[], timestamptz)', 'execute')
     or not has_function_privilege('authenticated', 'public.referral_leaderboard(timestamptz, timestamptz, integer)', 'execute') then
    raise exception 'self-check: a rewritten function lost authenticated execute';
  end if;
end $$;
