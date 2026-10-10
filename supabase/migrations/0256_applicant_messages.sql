-- 0256: the applicant message log, the shared 20-per-day limit, and organizations.premium_until (owner spec 10 Oct: "Message candidate" on the applicants page, relay email, premium Farah drafting).
--
-- WHAT IT ADDS
--   1. public.applicant_messages: one row per message an employer sends to an applicant through Talentrah (kind, subject, body, who, when, status). It holds NO email address: the candidate's address is read with the
--      service role at send time and never stored here, never returned to the employer.
--   2. public.claim_applicant_message(...): the ONE place the limit of 20 employer-sent messages per organisation per UTC day is decided. It takes a per-organisation advisory lock, counts today's live rows
--      (status claimed or sent; a failed message gives its slot back) and inserts the new row in the same call, so two overlapping sends can never both pass at 19. Interview invites (0253) call this same function
--      with kind 'interview_invite', so the limit cannot drift between messages and invites. Confirmations, reminders, .ics files and "None of these work" never claim.
--   3. public.organizations.premium_until (timestamptz, nullable): the date until which an organisation has Premium. Set by an administrator only, through admin_set_organization_premium (audited, service role only; no purchase flow yet); the server refuses "Draft/Refine with Farah" when it is
--      null or in the past. It is NOT readable by the API roles either (0232's column-level SELECT list is left as it is, so a column added later is unreadable until granted; the server reads it with the service role), and it
--      joins the withheld list in tests/support/identifier-column-guard-titles.ts and fake-grants-client.ts. Nobody with an API session can write it (the organizations UPDATE grant is column-level since 0028, and this column is not in it; the INSERT policy requires it to be null).
--
-- THE DAY IS THE UTC DAY. A row created at 00:00:00 UTC counts for the new day; a row one second before does not.
--
-- ACCESS. The table is read-only to the API: members of the organisation can SELECT their own organisation's log (is_org_member), nobody can INSERT/UPDATE/DELETE through the API, and anon has nothing. The function is
-- service-role only. A message is written, marked sent or failed, only by server code running with the service role.
--
-- PER-REQUEST COST. Server work per request: one advisory lock, one indexed count over today's rows of one organisation, one insert per message sent. Nothing runs on page loads except the "N of 20 left today" count.
--
-- ADDITIVE for the running app: no deployed code names the table, the function or the column. Applied BEFORE the code that uses them merges. The exact undo is supabase/rollbacks/0256_applicant_messages.rollback.sql.

create table if not exists public.applicant_messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  application_id   uuid references public.applications(id) on delete set null,
  job_posting_id   uuid references public.job_postings(id) on delete set null,
  sender_user_id   uuid references public.profiles(id) on delete set null,
  kind             text not null check (kind in ('invite_interview', 'request_info', 'not_moving_forward', 'custom', 'interview_invite')),
  subject          text not null check (char_length(subject) between 1 and 200),
  body             text not null check (char_length(body) between 1 and 5000),
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

alter table public.organizations
  add column if not exists premium_until timestamptz;

comment on column public.organizations.premium_until is
  '0256: Premium runs until this moment; null or in the past means not Premium. Set by an administrator only (no purchase flow yet). The server refuses Farah drafting without it. Not writable through the API.';

-- premium_until must not be smuggled in at CREATE time either: organizations has a table-level INSERT grant for the API roles (the row policy, not a column list, is what pins verified and the CAC columns since 0114/0120), so the
-- policy is widened by exactly one condition. Everything else in it is 0120's definition, unchanged.
drop policy if exists "authenticated users can create an organization" on public.organizations;

create policy "authenticated users can create an organization"
  on public.organizations
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and verified = false
    and cac_confirmed_at is null
    and cac_confirmed_by is null
    and premium_until is null
  );

-- The ONLY way premium_until changes: an administrator, through this function, and every change leaves a row in admin_audit_log (who, what it was, what it became, why). No API role can UPDATE the column (the
-- grant is column-level and does not include it), none can set it when creating an organisation (the INSERT policy above), and none can execute this function: it is service-role only, called by admin tooling that
-- passes the acting operator's identity. A reason is required, so an unexplained Premium cannot exist. Premium is an access gate only (Farah drafting on the Message candidate form); what Farah costs is charged to the ad wallet.
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

  select premium_until into v_before from public.organizations where id = p_organization_id for update;
  if not found then
    raise exception 'admin_set_organization_premium: organization % not found', p_organization_id;
  end if;

  update public.organizations set premium_until = p_premium_until where id = p_organization_id;

  insert into public.admin_audit_log (admin_user_id, admin_email, admin_session_id, action, target_table, target_id, detail)
  values (
    p_admin_user_id,
    p_admin_email,
    p_admin_session_id,
    'organization.premium_set',
    'organizations',
    p_organization_id::text,
    jsonb_build_object('from', v_before, 'to', p_premium_until, 'reason', p_reason)
  );

  return p_premium_until;
end
$fn$;

revoke all on function public.admin_set_organization_premium(uuid, timestamptz, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_organization_premium(uuid, timestamptz, uuid, text, uuid, text) to service_role;

comment on function public.admin_set_organization_premium(uuid, timestamptz, uuid, text, uuid, text) is
  '0256: the only way organizations.premium_until changes. Sets (or clears, with null) the date and writes an admin_audit_log row with the before and after and the reason, in one call. A reason and an acting identity are required. Service role only.';

-- Self-check: the objects exist as designed and the API roles have only what was intended.
do $check$
begin
  if to_regclass('public.applicant_messages') is null then
    raise exception '0256: applicant_messages was not created';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.applicant_messages'::regclass) then
    raise exception '0256: row level security is off on applicant_messages';
  end if;
  if has_table_privilege('anon', 'public.applicant_messages', 'select')
     or has_table_privilege('authenticated', 'public.applicant_messages', 'insert')
     or has_table_privilege('authenticated', 'public.applicant_messages', 'update')
     or has_table_privilege('authenticated', 'public.applicant_messages', 'delete') then
    raise exception '0256: an API role has more than SELECT (authenticated) on applicant_messages';
  end if;
  if has_function_privilege('authenticated', 'public.claim_applicant_message(uuid, uuid, uuid, uuid, text, text, text, integer)', 'execute')
     or has_function_privilege('anon', 'public.claim_applicant_message(uuid, uuid, uuid, uuid, text, text, text, integer)', 'execute') then
    raise exception '0256: an API role can execute claim_applicant_message';
  end if;
  if has_column_privilege('authenticated', 'public.organizations', 'premium_until', 'update')
     or has_column_privilege('anon', 'public.organizations', 'premium_until', 'update') then
    raise exception '0256: an API role can UPDATE organizations.premium_until';
  end if;
  if has_function_privilege('authenticated', 'public.admin_set_organization_premium(uuid, timestamptz, uuid, text, uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.admin_set_organization_premium(uuid, timestamptz, uuid, text, uuid, text)', 'execute') then
    raise exception '0256: an API role can execute admin_set_organization_premium';
  end if;
  if not exists (
    select 1 from pg_policy
     where polrelid = 'public.organizations'::regclass and polcmd = 'a'
       and pg_get_expr(polwithcheck, polrelid) like '%premium_until IS NULL%'
  ) then
    raise exception '0256: the organizations INSERT policy does not pin premium_until to null';
  end if;
end
$check$;
