-- 0212: account deletion, part 1 (ACCT-1 PR 1): request, emailed confirm link, hide immediately, stop mail and money.
--
-- WHAT THIS DOES. A signed-in user can ask to delete their account. The request is confirmed from an emailed, single-use link that expires in one
-- hour and works only for the same user's session. Confirming schedules the hard delete 30 days out (a later PR runs it) and, in the same
-- transaction: hides the account from every surface other people read it through, cancels Auto-Apply, cancels Pass and Talent Directory auto-renewal
-- in the database, and (for a person who is the only member of an organisation) closes that organisation's open postings and pauses its running
-- campaigns. The card authorisations themselves are cancelled at the payment provider BEFORE this runs (src/lib/account-deletion/actions.ts): a
-- database transaction cannot contain a provider call, so the application does it first and refuses to schedule anything if it fails.
-- Signing in again inside the 30 days offers "restore it, or keep the deletion"; restoring is one call and never silent.
--
-- THE FLAG IS THE SINGLE SOURCE. `profiles.deletion_requested_at` is set only inside account_deletion_confirm() and cleared only inside
-- account_deletion_restore(). It carries no UPDATE grant for any client (grants on `profiles` are column lists, CLAUDE.md), so a signed-in user
-- cannot clear it with a direct PATCH. Every hiding rule below reads this one column, in the database, so the app being bypassed (the repo is public
-- and the anon key ships to browsers) changes nothing.
--
-- THE LINK TOKEN. Only its sha256 is stored (account_deletions.token_hash, unique). A presented token is hashed and the row is found by an index
-- lookup on that hash AND the session's own user id, under a row lock: there is no byte-by-byte comparison of the secret to time, an attacker
-- controls only the preimage, and a link used or opened by anyone but its owner matches no row. A new request supersedes every earlier link.
--
-- WHAT IS HIDDEN, AND WHERE (the read surfaces other people use to see a person):
--   Talent Directory     talent_directory_listed_ids() (the one place the count, the preview, the paid search and the portfolio all start from),
--                        talent_directory_portfolio_items(), request_talent_directory_contact()
--   Employer applicants  employer_job_applicants(), employer_application_screening_answers(), employer_view_resume(), employer_resume_view_context(),
--                        record_employer_resume_view(), org_application_counts(), can_access_assessment_submission(), and the employer branch of the
--                        two assessment-submission SELECT policies (the applicant's own access is untouched)
--   Mentor discovery     the SELECT policies on mentor_profiles, mentor_availability_slots and mentorship_reviews, open_mentor_slots(),
--                        mentor_public_names(), mentorship_session_counterparty_names(), and book_mentor_session() (a departing mentor cannot be booked)
--   Referral leaderboard referral_leaderboard()
-- Each is patched FROM ITS LIVE DEFINITION (see pg_temp.patch_fn below): one added predicate, nothing else changed.
--
-- WHAT IS NOT CHANGED HERE. Nothing is deleted or anonymised: the 30-day purge, the export, and the anonymisation of money tables (0209 already
-- made those FKs SET NULL) are later PRs. Unused credits are only RECORDED as forfeited (account_deletions.credits_forfeited, informational);
-- the balance stays until the purge so a restore gives it all back. An organisation's ad wallet is not forfeited at all: it stays with the
-- organisation. refund_policy and refund_note are nullable and unused, so a refund policy can be added later with no migration.
--
-- WHO MAY CALL WHAT. blockers / create_request / confirm_precheck / confirm are service-role only: they take the user id as an argument, so they are
-- never callable with a client's own token, and the Server Action takes that id from the verified session. account_deletion_restore and
-- account_deletion_status are the only ones a signed-in user can call, and they act on auth.uid() alone. account_is_active and the two small helpers
-- the assessment policies use are executable by authenticated (RLS policies call them) and not by anon. function_acl_audit() is service-role only.
--
-- ADDITIVE for the running app (a nullable column, a new table, new functions, and added predicates that are all true while the column is
-- null), so it is applied to production BEFORE the merge, after a rolled-back dry run and the owner's yes. The exact undo is in
-- supabase/rollbacks/0212_account_deletion_request.rollback.sql.

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

-- 3. The predicates other policies and functions use ------------------------------------------------------------------------------------------
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

-- The same question by application id and by assessment-submission id, for the two assessment SELECT policies. A policy subquery runs as the caller and
-- would inherit applications' owner-only RLS (an org member would see no row at all), so the lookup has to be a definer function.
create or replace function public.application_applicant_is_active(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.applications a join public.profiles p on p.id = a.user_id
     where a.id = p_application_id and p.deletion_requested_at is not null
  );
$$;
revoke execute on function public.application_applicant_is_active(uuid) from public, anon;
grant execute on function public.application_applicant_is_active(uuid) to authenticated, service_role;

create or replace function public.submission_applicant_is_active(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.application_assessment_submissions s
      join public.applications a on a.id = s.application_id
      join public.profiles p on p.id = a.user_id
     where s.id = p_submission_id and p.deletion_requested_at is not null
  );
$$;
revoke execute on function public.submission_applicant_is_active(uuid) from public, anon;
grant execute on function public.submission_applicant_is_active(uuid) to authenticated, service_role;

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
  v_wallet     bigint;
begin
  -- Paid mentoring that has not happened yet, on either side. A confirmed or awaiting-confirmation session with a price is money held for a
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

  -- What that organisation's ad wallet holds. It is not the person's money and is never forfeited; it is reported so they can see nobody can use it
  -- unless they restore the account or someone joins.
  select coalesce(sum(w.balance_ngn), 0) into v_wallet
  from public.organization_members om
  join public.ad_wallets w on w.organization_id = om.organization_id
  where om.user_id = p_user_id
    and not exists (select 1 from public.organization_members x where x.organization_id = om.organization_id and x.user_id <> p_user_id);

  return jsonb_build_object(
    'mentorship_sessions', v_sessions,
    'mentor_payouts', v_payouts,
    'organisations_with_other_members', v_org_shared,
    'postings_to_close', v_close,
    'campaigns_to_pause', v_campaigns,
    'ad_wallet_balance_ngn', v_wallet,
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

-- 6. The precheck: every refusal the confirm can give, without changing anything -----------------------------------------------------------------
-- Run by the Server Action BEFORE it touches the card, so a bad, used, replaced or expired link never costs the person a card cancellation. It also
-- lists the stored card authorisations that have to be cancelled at the payment provider: active Pass renewals, and active Talent Directory
-- renewals for organisations this person created (those are charged to their card).
create or replace function public.account_deletion_confirm_precheck(p_user_id uuid, p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.account_deletions%rowtype;
  v_deleted_at timestamptz;
  v_blockers jsonb;
  v_auths jsonb;
begin
  select * into v_row from public.account_deletions where token_hash = p_token_hash and profile_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_row.status = 'superseded' then
    return jsonb_build_object('ok', false, 'reason', 'superseded');
  end if;
  if v_row.status <> 'pending_confirmation' then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  if v_row.token_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  select deletion_requested_at into v_deleted_at from public.profiles where id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_scheduled');
  end if;
  v_blockers := public.account_deletion_blockers(p_user_id);
  if (v_blockers ->> 'blocked')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'blocked', 'blockers', v_blockers);
  end if;

  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_auths from (
    select jsonb_build_object('source', 'pass', 'id', up.id, 'authorization_code', up.authorization_code) as x
      from public.user_passes up
     where up.user_id = p_user_id and up.auto_renew_status = 'active' and up.authorization_code is not null
    union all
    select jsonb_build_object('source', 'talent_directory', 'id', s.id, 'authorization_code', s.authorization_code)
      from public.talent_directory_subscriptions s
      join public.organizations o on o.id = s.organization_id
     where o.created_by = p_user_id and s.auto_renew_status = 'active' and s.authorization_code is not null
  ) q;

  return jsonb_build_object('ok', true, 'authorizations', v_auths);
end;
$$;
revoke execute on function public.account_deletion_confirm_precheck(uuid, text) from public, anon, authenticated;
grant execute on function public.account_deletion_confirm_precheck(uuid, text) to service_role;

-- 7. Confirm: single use, one hour, this user only, everything in one transaction ---------------------------------------------------------------
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
  if v_row.status = 'superseded' then
    return jsonb_build_object('ok', false, 'reason', 'superseded');
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

  -- Stop renewals: a Pass the same four-column way the Billing page's own cancel does (cancelPassAutoRenewal), including dropping the stored card
  -- authorisation; and a Talent Directory subscription of an organisation this person created (it is charged to their card). Access already paid for
  -- is untouched. The authorisations were already cancelled at the payment provider by the Server Action before this ran.
  update public.user_passes
     set auto_renew = false, auto_renew_status = 'canceled', next_renewal_date = null, authorization_code = null
   where user_id = p_user_id and auto_renew_status = 'active';
  update public.talent_directory_subscriptions
     set auto_renew_status = 'canceled', next_renewal_date = null, authorization_code = null
   where auto_renew_status = 'active' and organization_id in (select id from public.organizations where created_by = p_user_id);

  -- A person who is the only member of an organisation: close its open postings (the list was shown to them) and pause what is spending money.
  -- The organisation, its postings, its ad wallet and the applications it received are kept; they are other people's records too. Applicants are
  -- not emailed: they see the ordinary closed state. (The existing sweep removes any posting 30 days after it closes; that is said in the confirm
  -- step and in the emails.)
  select coalesce(array_agg(om.organization_id), '{}'::uuid[]) into v_sole_orgs
  from public.organization_members om
  where om.user_id = p_user_id
    and not exists (select 1 from public.organization_members x where x.organization_id = om.organization_id and x.user_id <> p_user_id);

  update public.job_postings set status = 'closed', closed_at = now()
   where organization_id = any (v_sole_orgs) and status = 'open';
  update public.ad_campaigns set status = 'paused_by_employer', updated_at = now()
   where organization_id = any (v_sole_orgs) and status = 'active';

  return jsonb_build_object(
    'ok', true,
    'hard_delete_after', v_hard_delete,
    'credits_forfeited', greatest(v_profile.credits_balance, 0),
    'closed_postings', v_blockers -> 'postings_to_close',
    'ad_wallet_balance_ngn', v_blockers -> 'ad_wallet_balance_ngn'
  );
end;
$$;
revoke execute on function public.account_deletion_confirm(uuid, text) from public, anon, authenticated;
grant execute on function public.account_deletion_confirm(uuid, text) to service_role;

-- 8. A signed-in user's own two calls ------------------------------------------------------------------------------------------------------
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

-- Restore, on the person's choice. It puts back exactly one thing: visibility. Auto-Apply stays off, Pass and Talent Directory renewal stay cancelled
-- (the stored cards are gone) and the postings closed at confirm stay closed, because none of those is something to switch on for someone who only came
-- back to look.
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

-- 9. What every public function's definer setting, search_path and grants are, for the test that proves 0212 changed none of them ----------------------
create or replace function public.function_acl_audit()
returns table(function_name text, identity_args text, security_definer boolean, search_path_config text, anon_exec boolean, authenticated_exec boolean, service_role_exec boolean, public_exec boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.proname::text, pg_catalog.pg_get_function_identity_arguments(p.oid), p.prosecdef,
         coalesce((select c from unnest(p.proconfig) c where c like 'search_path=%' limit 1), null),
         pg_catalog.has_function_privilege('anon', p.oid, 'execute'),
         pg_catalog.has_function_privilege('authenticated', p.oid, 'execute'),
         pg_catalog.has_function_privilege('service_role', p.oid, 'execute'),
         exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
    from pg_catalog.pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f';
$$;
revoke execute on function public.function_acl_audit() from public, anon, authenticated;
grant execute on function public.function_acl_audit() to service_role;

-- 10. Hide, by patching the live definitions ---------------------------------------------------------------------------------------------------

-- The two helpers below live in pg_temp: they exist for this migration's own session only and leave nothing behind.
--
-- patch_fn takes a function's CURRENT definition from the catalogue (pg_get_functiondef), replaces each anchor with its replacement, and recreates it.
-- Every anchor must be found EXACTLY once or the whole migration fails, and a pair whose replacement is already there is skipped (so re-running is
-- harmless). Because it patches what is live at the moment it runs, it cannot revert a change that landed in between, and the function keeps its
-- SECURITY DEFINER setting, its pinned search_path and its grants (CREATE OR REPLACE keeps the ACL; the header comes from the live definition).
create or replace function pg_temp.patch_fn(p_sig text, p_pairs text[]) returns void
language plpgsql as $patch$
declare
  v_oid oid := to_regprocedure(p_sig);
  v_def text;
  v_new text;
  v_cnt integer;
  i integer;
begin
  if v_oid is null then raise exception '0212: function % not found', p_sig; end if;
  v_def := pg_get_functiondef(v_oid);
  v_new := v_def;
  i := 1;
  while i <= array_length(p_pairs, 1) loop
    if position(p_pairs[i + 1] in v_new) = 0 then
      v_cnt := (length(v_new) - length(replace(v_new, p_pairs[i], ''))) / length(p_pairs[i]);
      if v_cnt <> 1 then
        raise exception '0212: anchor % found % times in % (it must be found exactly once)', quote_literal(p_pairs[i]), v_cnt, p_sig;
      end if;
      v_new := replace(v_new, p_pairs[i], p_pairs[i + 1]);
    end if;
    i := i + 2;
  end loop;
  if v_new <> v_def then execute v_new; end if;
end
$patch$;

-- patch_policy does the same for one SELECT policy's USING expression, found by the start of its name (Postgres truncates long policy names, and
-- one of these ends in a space, so the name is read from pg_policies rather than retyped).
create or replace function pg_temp.patch_policy(p_table regclass, p_like text, p_from text, p_to text) returns void
language plpgsql as $patch$
declare
  v_name text;
  v_qual text;
  v_new text;
  v_cnt integer;
begin
  select policyname, qual into v_name, v_qual from pg_policies
   where schemaname = 'public' and tablename = (select c.relname from pg_class c where c.oid = p_table) and cmd = 'SELECT' and policyname like p_like;
  if v_name is null then raise exception '0212: no SELECT policy like % on %', p_like, p_table; end if;
  if position(p_to in v_qual) > 0 then return; end if;
  v_cnt := (length(v_qual) - length(replace(v_qual, p_from, ''))) / length(p_from);
  if v_cnt <> 1 then raise exception '0212: anchor % found % times in the % policy', quote_literal(p_from), v_cnt, p_table; end if;
  v_new := replace(v_qual, p_from, p_to);
  execute format('alter policy %I on %s using (%s)', v_name, p_table, v_new);
end
$patch$;

select pg_temp.patch_fn($x$public.talent_directory_listed_ids()$x$, array[
    $x$and p.talent_verification_status = 'verified'$x$,
    $x$and p.talent_verification_status = 'verified'
    and p.deletion_requested_at is null$x$
  ]);
select pg_temp.patch_fn($x$public.talent_directory_portfolio_items(uuid)$x$, array[
    $x$and p.talent_verification_status = 'verified'$x$,
    $x$and p.talent_verification_status = 'verified'
      and p.deletion_requested_at is null$x$
  ]);
select pg_temp.patch_fn($x$public.request_talent_directory_contact(uuid, uuid, text, uuid)$x$, array[
    $x$and p.talent_verification_status = 'verified'$x$,
    $x$and p.talent_verification_status = 'verified'
      and p.deletion_requested_at is null$x$
  ]);
select pg_temp.patch_fn($x$public.employer_job_applicants(uuid)$x$, array[
    $x$and a.applied_at is not null$x$,
    $x$and a.applied_at is not null
    and p.deletion_requested_at is null$x$
  ]);
select pg_temp.patch_fn($x$public.employer_application_screening_answers(uuid)$x$, array[
    $x$and public.is_org_member(j.organization_id)$x$,
    $x$and public.is_org_member(j.organization_id)
    and public.account_is_active(app.user_id)$x$
  ]);
select pg_temp.patch_fn($x$public.employer_resume_view_context(uuid)$x$, array[
    $x$and public.is_org_member_for_application(p_application_id)$x$,
    $x$and public.is_org_member_for_application(p_application_id)
    and public.account_is_active(a.user_id)$x$
  ]);
select pg_temp.patch_fn($x$public.employer_view_resume(uuid)$x$, array[
    $x$and public.is_org_member(j.organization_id)$x$,
    $x$and public.is_org_member(j.organization_id)
    and public.account_is_active(a.user_id)$x$
  ]);
select pg_temp.patch_fn($x$public.record_employer_resume_view(uuid)$x$, array[
    $x$where public.is_org_member_for_application(p_application_id)$x$,
    $x$where public.is_org_member_for_application(p_application_id)
      and public.application_applicant_is_active(p_application_id)$x$
  ]);
select pg_temp.patch_fn($x$public.org_application_counts(uuid)$x$, array[
    $x$and public.is_org_member(p_organization_id)$x$,
    $x$and public.is_org_member(p_organization_id)
    and public.account_is_active(a.user_id)$x$
  ]);
select pg_temp.patch_fn($x$public.can_access_assessment_submission(text)$x$, array[
    $x$or public.is_org_member(f.organization_id)$x$,
    $x$or (public.is_org_member(f.organization_id) and public.account_is_active(a.user_id))$x$
  ]);
select pg_temp.patch_fn($x$public.referral_leaderboard(timestamptz, timestamptz, integer)$x$, array[
    $x$and p.referral_leaderboard_opt_in = true$x$,
    $x$and p.referral_leaderboard_opt_in = true
    and p.deletion_requested_at is null$x$
  ]);
select pg_temp.patch_fn($x$public.open_mentor_slots(uuid[], timestamptz)$x$, array[
    $x$and not m.self_paused$x$,
    $x$and not m.self_paused
      and public.account_is_active(m.user_id)$x$
  ]);
select pg_temp.patch_fn($x$public.mentor_public_names(uuid[])$x$, array[
    $x$and not mp.self_paused$x$,
    $x$and not mp.self_paused
      and p.deletion_requested_at is null$x$
  ]);
select pg_temp.patch_fn($x$public.book_mentor_session(uuid, uuid, text)$x$, array[
    $x$  if v_mentor_self_paused then
    raise exception 'MENTOR_PAUSED';
  end if;
$x$,
    $x$  if v_mentor_self_paused then
    raise exception 'MENTOR_PAUSED';
  end if;

  if not public.account_is_active(v_mentor_id) then
    raise exception 'MENTOR_NOT_APPROVED';
  end if;
$x$
  ]);
select pg_temp.patch_fn($x$public.mentorship_session_counterparty_names(uuid[])$x$, array[
    $x$where p.id = any(p_user_ids)$x$,
    $x$where p.id = any(p_user_ids)
      and p.deletion_requested_at is null$x$
  ]);
select pg_temp.patch_fn($x$public.reset_test_pool_user(uuid, text)$x$, array[
    $x$  update public.talent_verifications set reviewer_id = null where reviewer_id = p_user_id;
$x$,
    $x$  update public.talent_verifications set reviewer_id = null where reviewer_id = p_user_id;

  delete from public.account_deletions where profile_id = p_user_id;
$x$,
    $x$    talent_boosted_until = null,
$x$,
    $x$    talent_boosted_until = null,
    deletion_requested_at = null,
$x$
  ]);
select pg_temp.patch_policy($x$public.mentor_profiles$x$, $x$mentor profiles are approved-and-public%$x$, $x$(NOT self_paused)$x$, $x$(NOT self_paused) AND public.account_is_active(user_id)$x$);
select pg_temp.patch_policy($x$public.mentor_availability_slots$x$, $x$availability is visible for approved mentors%$x$, $x$(NOT mp.self_paused)$x$, $x$(NOT mp.self_paused) AND public.account_is_active(mp.user_id)$x$);
select pg_temp.patch_policy($x$public.mentorship_reviews$x$, $x$reviews of approved mentors are publicly readable%$x$, $x$(mp.status = 'approved'::text)$x$, $x$(mp.status = 'approved'::text) AND public.account_is_active(mp.user_id)$x$);
select pg_temp.patch_policy($x$public.application_assessment_submissions$x$, $x$candidate or owning org can read an assessment submission%$x$, $x$is_org_member(organization_id)$x$, $x$(is_org_member(organization_id) AND public.application_applicant_is_active(application_id))$x$);
select pg_temp.patch_policy($x$public.application_assessment_response_files$x$, $x$candidate or owning org can read response files%$x$, $x$is_org_member(organization_id)$x$, $x$(is_org_member(organization_id) AND public.submission_applicant_is_active(application_assessment_submission_id))$x$);

-- 11. Self-check: the migration fails (and rolls back) unless every piece took effect --------------------------------------------------------------
do $$
declare
  fn text;
  v_oid oid;
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
    'public.account_deletion_confirm_precheck(uuid, text)',
    'public.account_deletion_confirm(uuid, text)',
    'public.function_acl_audit()'
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
  foreach fn in array array['public.account_is_active(uuid)', 'public.application_applicant_is_active(uuid)', 'public.submission_applicant_is_active(uuid)'] loop
    if has_function_privilege('anon', fn, 'execute') then
      raise exception 'self-check: % is callable by anon', fn;
    end if;
    if not has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'self-check: % is not callable by authenticated (RLS policies call it)', fn;
    end if;
  end loop;
  -- The functions this migration patched keep what they had: nothing may gain anon execute, and the two that signed-in users call stay callable.
  if has_function_privilege('anon', 'public.employer_job_applicants(uuid)', 'execute') then
    raise exception 'self-check: employer_job_applicants gained anon execute';
  end if;
  if has_function_privilege('anon', 'public.referral_leaderboard(timestamptz, timestamptz, integer)', 'execute') then
    raise exception 'self-check: referral_leaderboard gained anon execute (0211 removed it)';
  end if;
  if not has_function_privilege('authenticated', 'public.open_mentor_slots(uuid[], timestamptz)', 'execute')
     or not has_function_privilege('authenticated', 'public.referral_leaderboard(timestamptz, timestamptz, integer)', 'execute') then
    raise exception 'self-check: a patched function lost authenticated execute';
  end if;
  -- Every patch really landed: each patched function now mentions the flag or one of the helpers.
  for v_oid in
    select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(array[
      'talent_directory_listed_ids','talent_directory_portfolio_items','request_talent_directory_contact','employer_job_applicants',
      'employer_application_screening_answers','employer_resume_view_context','employer_view_resume','record_employer_resume_view','org_application_counts',
      'can_access_assessment_submission','referral_leaderboard','open_mentor_slots','mentor_public_names','book_mentor_session',
      'mentorship_session_counterparty_names','reset_test_pool_user'])
  loop
    if pg_get_functiondef(v_oid) !~ 'deletion_requested_at|account_is_active|applicant_is_active' then
      raise exception 'self-check: % was not patched', v_oid::regprocedure;
    end if;
  end loop;
end $$;
