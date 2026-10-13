-- 0256: the applicant message log, the shared 20-per-day limit, and an admin-set Premium date (owner spec 10 Oct: "Message candidate" on the applicants page, relay email, premium Farah drafting).
--
-- WHAT IT ADDS
--   1. public.applicant_messages: one row per message an employer sends to an applicant through Talentrah (kind, subject, body, who, when, status). It holds NO email address: the candidate's address is read with the
--      service role at send time and never stored here, never returned to the employer.
--   2. public.claim_applicant_message(...): the ONE place the limit of 20 employer-sent messages per organisation per UTC day is decided. It takes a per-organisation advisory lock, counts today's live rows
--      (status claimed or sent; a failed message gives its slot back) and inserts the new row in the same call, so two overlapping sends can never both pass at 19. Interview invites (0253) call this same function
--      with kind 'interview_invite', so the limit cannot drift between messages and invites. Confirmations, reminders, .ics files and "None of these work" never claim.
--   3. public.organization_premium (organization_id, premium_until) and public.admin_set_organization_premium(...): the date until which an organisation has Premium. A SEPARATE table on purpose: organizations is publicly
--      readable and creatable by the API roles, so a premium column there would have needed a change to its INSERT policy and to the 0232 withheld-column lists, while a table with no grants for the API roles needs
--      neither. The date is set ONLY by the function (SECURITY DEFINER, service role only, audited in admin_audit_log with who, before, after and why; no purchase flow yet). The server refuses "Draft/Refine with
--      Farah" when the organisation has no row or the date has passed. Premium is an access gate only: what Farah costs is charged to the ad wallet.
--   4. One new value on the enum public.ad_wallet_reason, 'farah_message_draft_charge': what "Draft/Refine with Farah" on the Message candidate form debits from the employer's ad wallet (the same direct
--      debit_ad_wallet / credit_ad_wallet shape 0181 uses for job scoping; a failed draft is credited back with the existing 'reversal' reason). The enum value is added here and not used in this file.
--
-- WHEN THE CANDIDATE IS DELETED (owner decision, 10 Oct): the log row STAYS (the organisation's record that it sent something, and the daily count, are unchanged), the link to the application is detached (the existing ON DELETE SET
-- NULL) and SUBJECT AND BODY ARE BLANKED, because they can name or describe the person. That is why both columns now allow an empty string. A BEFORE DELETE trigger on applications does the blanking (SECURITY DEFINER, pinned search_path, no grant
-- to any API role), so EVERY path that removes an application is covered: the account deletion cascade, a direct delete, an application removed with its job. kind, sender, organisation, status, created_at and sent_at are kept. The trigger
-- swallows its own error with a warning: a failure here must never block a person's account deletion (the warning is the signal; the log keeps no address).
--
-- THE DAY IS THE UTC DAY. A row created at 00:00:00 UTC counts for the new day; a row one second before does not.
--
-- ACCESS. applicant_messages is read-only to the API: members of the organisation can SELECT their own organisation's log (is_org_member), nobody can INSERT/UPDATE/DELETE through the API, and anon has nothing.
-- organization_premium has no policy and no grant for any API role (not even SELECT): the server reads it with the service role. Both functions are service-role only. A message is written, marked sent or failed, only
-- by server code running with the service role.
--
-- PER-REQUEST COST. Server work per request: one advisory lock, one indexed count over today's rows of one organisation, one insert per message sent; one primary-key read of organization_premium when the Farah
-- drafting button is used. Nothing runs on page loads except the "N of 20 left today" count.
--
-- ADDITIVE for the running app: no deployed code names the tables or the functions. Applied BEFORE the code that uses them merges. The exact undo is supabase/rollbacks/0256_applicant_messages.rollback.sql.

create table if not exists public.applicant_messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  application_id   uuid references public.applications(id) on delete set null,
  job_posting_id   uuid references public.job_postings(id) on delete set null,
  sender_user_id   uuid references public.profiles(id) on delete set null,
  kind             text not null check (kind in ('invite_interview', 'request_info', 'not_moving_forward', 'custom', 'interview_invite')),
  subject          text not null check (char_length(subject) between 0 and 200),
  body             text not null check (char_length(body) between 0 and 5000),
  status           text not null default 'claimed' check (status in ('claimed', 'sent', 'failed')),
  failure_reason   text,
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);

comment on table public.applicant_messages is
  '0256: one row per employer-sent message to an applicant (relay email) or interview invite. Holds no email address. Written only by the service role through claim_applicant_message; members of the organisation can read their own log.';

create index if not exists applicant_messages_org_day_idx on public.applicant_messages (organization_id, created_at desc);
create index if not exists applicant_messages_application_idx on public.applicant_messages (application_id, created_at desc) where application_id is not null;

alter table public.applicant_messages enable row level security;

drop policy if exists applicant_messages_member_select on public.applicant_messages;
create policy applicant_messages_member_select
  on public.applicant_messages
  for select
  to authenticated
  using (public.is_org_member(organization_id));

revoke all on public.applicant_messages from anon, authenticated;
grant select on public.applicant_messages to authenticated;

create or replace function public.blank_applicant_messages_on_application_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $f$
begin
  update public.applicant_messages set subject = '', body = '' where application_id = old.id and (subject <> '' or body <> '');
  return old;
exception when others then
  raise warning '0256: could not blank the messages of deleted application %: %', old.id, sqlerrm;
  return old;
end
$f$;

revoke all on function public.blank_applicant_messages_on_application_delete() from public, anon, authenticated;

drop trigger if exists applications_blank_applicant_messages on public.applications;
create trigger applications_blank_applicant_messages
  before delete on public.applications
  for each row execute function public.blank_applicant_messages_on_application_delete();

create or replace function public.claim_applicant_message(
  p_organization_id uuid,
  p_application_id uuid,
  p_job_posting_id uuid,
  p_sender_user_id uuid,
  p_kind text,
  p_subject text,
  p_body text,
  p_daily_limit integer default 20
) returns uuid
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_used integer;
  v_id uuid;
begin
  -- One organisation's claims are serialised: the count and the insert below are one step as far as any other claim for the same organisation can tell.
  perform pg_advisory_xact_lock(hashtextextended('applicant_messages:' || p_organization_id::text, 0));

  select count(*) into v_used
    from public.applicant_messages
   where organization_id = p_organization_id
     and status in ('claimed', 'sent')
     and created_at >= v_day_start;

  if v_used >= p_daily_limit then
    return null;
  end if;

  insert into public.applicant_messages (organization_id, application_id, job_posting_id, sender_user_id, kind, subject, body)
  values (p_organization_id, p_application_id, p_job_posting_id, p_sender_user_id, p_kind, p_subject, p_body)
  returning id into v_id;

  return v_id;
end
$fn$;

revoke all on function public.claim_applicant_message(uuid, uuid, uuid, uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_applicant_message(uuid, uuid, uuid, uuid, text, text, text, integer) to service_role;

comment on function public.claim_applicant_message(uuid, uuid, uuid, uuid, text, text, text, integer) is
  '0256: claims one of an organisation''s daily message slots (default 20 per UTC day) and writes the log row in the same call. Returns the new row id, or null when the day is full. Failed rows do not count. Service role only.';

create table if not exists public.organization_premium (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  premium_until   timestamptz not null,
  updated_at      timestamptz not null default now()
);

comment on table public.organization_premium is
  '0256: Premium runs until premium_until for the organisation; no row, or a date in the past, means not Premium. Written only by admin_set_organization_premium; no API role can read or write it (RLS on, no policy, no grants). The server reads it with the service role.';

alter table public.organization_premium enable row level security;
revoke all on public.organization_premium from anon, authenticated;

-- The ONLY way Premium changes: an administrator, through this function, and every change leaves a row in admin_audit_log (who, what it was, what it became, why). No API role can read or write the table (no grants,
-- RLS with no policy), and none can execute this function: it is service-role only, called by admin tooling that passes the acting operator's identity. A null date ends Premium (the row is removed). A reason is
-- required, so an unexplained Premium cannot exist.
create or replace function public.admin_set_organization_premium(
  p_organization_id uuid,
  p_premium_until timestamptz,
  p_admin_user_id uuid,
  p_admin_email text,
  p_admin_session_id uuid,
  p_reason text
) returns timestamptz
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_before timestamptz;
begin
  if p_admin_email is null or btrim(p_admin_email) = '' then
    raise exception 'admin_set_organization_premium: an acting identity (email) is required';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'admin_set_organization_premium: a reason is required';
  end if;
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'admin_set_organization_premium: organization % not found', p_organization_id;
  end if;

  select premium_until into v_before from public.organization_premium where organization_id = p_organization_id for update;

  if p_premium_until is null then
    delete from public.organization_premium where organization_id = p_organization_id;
  else
    insert into public.organization_premium (organization_id, premium_until)
    values (p_organization_id, p_premium_until)
    on conflict (organization_id) do update set premium_until = excluded.premium_until, updated_at = now();
  end if;

  insert into public.admin_audit_log (admin_user_id, admin_email, admin_session_id, action, target_table, target_id, detail)
  values (
    p_admin_user_id,
    p_admin_email,
    p_admin_session_id,
    'organization.premium_set',
    'organization_premium',
    p_organization_id::text,
    jsonb_build_object('from', v_before, 'to', p_premium_until, 'reason', p_reason)
  );

  return p_premium_until;
end
$fn$;

revoke all on function public.admin_set_organization_premium(uuid, timestamptz, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_organization_premium(uuid, timestamptz, uuid, text, uuid, text) to service_role;

comment on function public.admin_set_organization_premium(uuid, timestamptz, uuid, text, uuid, text) is
  '0256: the only way an organisation''s Premium date changes. Sets (or ends, with null) the date and writes an admin_audit_log row with the before and after and the reason, in one call. A reason and an acting identity are required. Service role only.';

alter type public.ad_wallet_reason add value if not exists 'farah_message_draft_charge';

comment on type public.ad_wallet_reason is
  'debit reasons: campaign_charge (0046/0047 ad campaigns), farah_screening_charge (0176 — per-answer AI screening review), farah_jd_draft_charge (send-368 — per-draft AI job-scoping generation), farah_message_draft_charge (0256 — per-draft AI message to an applicant); credit reasons: topup, admin_adjustment, reversal.';

-- Self-check: the objects exist as designed and the API roles have only what was intended.
do $check$
begin
  if to_regclass('public.applicant_messages') is null or to_regclass('public.organization_premium') is null then
    raise exception '0256: a table was not created';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.applicant_messages'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.organization_premium'::regclass) then
    raise exception '0256: row level security is off on a new table';
  end if;
  if has_table_privilege('anon', 'public.applicant_messages', 'select')
     or has_table_privilege('authenticated', 'public.applicant_messages', 'insert')
     or has_table_privilege('authenticated', 'public.applicant_messages', 'update')
     or has_table_privilege('authenticated', 'public.applicant_messages', 'delete') then
    raise exception '0256: an API role has more than SELECT (authenticated) on applicant_messages';
  end if;
  if has_table_privilege('anon', 'public.organization_premium', 'select')
     or has_table_privilege('authenticated', 'public.organization_premium', 'select')
     or has_table_privilege('authenticated', 'public.organization_premium', 'insert')
     or has_table_privilege('authenticated', 'public.organization_premium', 'update')
     or has_table_privilege('authenticated', 'public.organization_premium', 'delete') then
    raise exception '0256: an API role has a privilege on organization_premium';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'applications_blank_applicant_messages' and tgrelid = 'public.applications'::regclass and not tgisinternal) then
    raise exception '0256: the blank-on-deletion trigger is missing on applications';
  end if;
  if has_function_privilege('authenticated', 'public.blank_applicant_messages_on_application_delete()', 'execute')
     or has_function_privilege('anon', 'public.blank_applicant_messages_on_application_delete()', 'execute') then
    raise exception '0256: an API role can execute the blanking function';
  end if;
  if has_function_privilege('authenticated', 'public.claim_applicant_message(uuid, uuid, uuid, uuid, text, text, text, integer)', 'execute')
     or has_function_privilege('anon', 'public.claim_applicant_message(uuid, uuid, uuid, uuid, text, text, text, integer)', 'execute') then
    raise exception '0256: an API role can execute claim_applicant_message';
  end if;
  if has_function_privilege('authenticated', 'public.admin_set_organization_premium(uuid, timestamptz, uuid, text, uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.admin_set_organization_premium(uuid, timestamptz, uuid, text, uuid, text)', 'execute') then
    raise exception '0256: an API role can execute admin_set_organization_premium';
  end if;
end
$check$;
