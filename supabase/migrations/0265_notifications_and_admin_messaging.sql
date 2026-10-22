-- 0265 (parts 1 and 2): the notification ledger, push devices, admin messaging and the two send limits, and the ledger functions.
--
-- Seven tables, their constraints, row security, explicit least-privilege grants, the ledger functions (claim, release, mark sent, stale claims, resolve a stale claim, unread count, prune) and
-- the quiet-hours predicate, and a self-check that is the LAST statement of this file. The admin-message functions come in a later part and are placed above the self-check.
--
-- Shape: the column lists are the contract's own (src/lib/notifications/contract.ts). Where the design (v3 section 7.2) differs from the contract, the contract wins (N1-R13).
-- Rulings applied: R8 (append-only tables: service_role may read and add, nothing else, and a trigger refuses the rest), R9 (a person reads five columns of their own devices and
-- deletes them by id), R14 (foreign keys), R15 (old_value is a nullable integer), R20 (the nine message statuses), R22 (an admin can be deleted while events and an approved message exist).
--
-- Grants follow the grants addendum: nothing leans on the platform's automatic grants. Every table is revoked from every client role first, then given exactly what it needs.
-- This file has no transaction control: the migration runner wraps it.

-- ---------------------------------------------------------------------------------------
-- push_subscriptions: one row per browser device of a person
-- ---------------------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  ua_short text not null,
  timezone text not null default 'Africa/Lagos',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text,
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_endpoint_len check (char_length(endpoint) <= 2048),
  constraint push_subscriptions_p256dh_len check (char_length(p256dh) <= 256),
  constraint push_subscriptions_auth_len check (char_length(auth) <= 256),
  constraint push_subscriptions_ua_short_len check (char_length(ua_short) <= 40),
  constraint push_subscriptions_timezone_len check (char_length(timezone) <= 64),
  constraint push_subscriptions_revoke_reason_check check (revoke_reason is null or revoke_reason in ('gone', 'user', 'kill', 'deleted', 'bad_key'))
);

-- ---------------------------------------------------------------------------------------
-- notification_deliveries: the claim ledger. One OPEN claim per person, kind, event, channel and device.
-- ---------------------------------------------------------------------------------------
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  subject_id uuid not null,
  device_id uuid references public.push_subscriptions (id) on delete set null,
  channel text not null,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  released_at timestamptz,
  constraint notification_deliveries_kind_check check (kind in ('new_applicant', 'application_viewed', 'match_alert', 'admin_message')),
  constraint notification_deliveries_channel_check check (channel in ('inapp', 'push', 'email'))
);

-- The key covers OPEN claims. A push claim whose device is gone (device_id was set to null when the device was deleted) is outside the key: two devices of one person can each hold an
-- open claim for the same event, and deleting both must not make the second delete collide with the first (N1-R27). A push claim is always made WITH a device, so nothing is lost; in-app
-- and email claims have no device and stay unique per person, kind, event and channel.
create unique index notification_deliveries_open_key
  on public.notification_deliveries (user_id, kind, subject_id, channel, coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where released_at is null and (channel <> 'push' or device_id is not null);

-- Foreign-key columns that deletes walk through get an index (N1-R27), so deleting a device or a person does not scan these tables.
create index notification_deliveries_device_id_idx on public.notification_deliveries (device_id);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

-- ---------------------------------------------------------------------------------------
-- admin_messages: one row per operator message
-- ---------------------------------------------------------------------------------------
create table public.admin_messages (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.admin_users (id) on delete set null,
  created_by_email text not null,
  kind text not null,
  title text not null,
  body text not null,
  link_path text,
  channels text[] not null,
  segment_key text not null,
  segment_params jsonb not null default '{}'::jsonb,
  consent_line text,
  status text not null default 'draft',
  requires_approval boolean not null default true,
  audience_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  kind_confirmed_by_approver text,
  approved_by uuid references public.admin_users (id) on delete set null,
  approved_by_email text,
  sent_started_at timestamptz,
  created_at timestamptz not null default now(),
  constraint admin_messages_kind_check check (kind in ('service_announcement', 'promotion')),
  constraint admin_messages_title_len check (char_length(title) between 1 and 80),
  constraint admin_messages_body_len check (char_length(body) between 1 and 500),
  constraint admin_messages_channels_check check (cardinality(channels) >= 1 and channels <@ array['inapp', 'push', 'email']::text[]),
  constraint admin_messages_segment_key_check check (segment_key in ('everyone', 'seekers', 'employers', 'verified_employers', 'inactive_seekers', 'signed_up_since', 'country', 'self_test')),
  constraint admin_messages_segment_params_check check (jsonb_typeof(segment_params) = 'object' and (segment_params - array['days', 'since', 'country']) = '{}'::jsonb),
  constraint admin_messages_status_check check (status in ('draft', 'prepared', 'submitted', 'approved', 'sending', 'sent', 'cancelled', 'paused_email_cap', 'paused_email_ceiling')),
  constraint admin_messages_counts_check check (audience_count >= 0 and sent_count >= 0 and failed_count >= 0 and skipped_count >= 0),
  -- The approver must differ from the creator. Written so that a deleted admin (the column is cleared by ON DELETE SET NULL) never makes a row fail.
  constraint admin_messages_approver_differs check (approved_by is null or created_by is null or approved_by <> created_by),
  -- A message that is approved, sending or sent has an approver, or does not need one. The email snapshot counts as proof so that deleting the approver (R22) is not blocked.
  constraint admin_messages_approved_needs_approver check (status not in ('approved', 'sending', 'sent') or not requires_approval or approved_by is not null or approved_by_email is not null),
  -- A promotion that has left draft carries the consent wording it was sent under (a cancelled draft never had one).
  constraint admin_messages_promotion_needs_consent check (kind <> 'promotion' or status in ('draft', 'cancelled') or consent_line is not null),
  constraint admin_messages_kind_confirmed_check check (kind_confirmed_by_approver is null or kind_confirmed_by_approver = kind),
  -- A link is a same-origin path: it starts with one slash, is not protocol-relative ("//host"), holds no backslash, whitespace or control character, and is at most 200 characters.
  constraint admin_messages_link_path_check check (link_path is null or (char_length(link_path) <= 200 and link_path ~ '^/([^/[:cntrl:][:space:]\\][^[:cntrl:][:space:]\\]*)?$'))
);

-- ---------------------------------------------------------------------------------------
-- admin_message_recipients: who a message was prepared for, with the per-channel flags and outcomes
-- ---------------------------------------------------------------------------------------
create table public.admin_message_recipients (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.admin_messages (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  to_inapp boolean not null default false,
  to_push boolean not null default false,
  to_email boolean not null default false,
  push_outcome text,
  email_outcome text,
  constraint admin_message_recipients_message_user_key unique (message_id, user_id),
  constraint admin_message_recipients_push_outcome_check check (push_outcome is null or push_outcome in ('sent', 'failed', 'skipped_opted_out', 'skipped_quiet_hours', 'skipped_cap', 'skipped_deleted', 'skipped_inactive')),
  constraint admin_message_recipients_email_outcome_check check (email_outcome is null or email_outcome in ('sent', 'failed', 'skipped_opted_out', 'skipped_quiet_hours', 'skipped_cap', 'skipped_deleted', 'skipped_inactive'))
);

create index admin_message_recipients_user_id_idx on public.admin_message_recipients (user_id);

-- ---------------------------------------------------------------------------------------
-- admin_message_events: the audit trail of a message (append-only; actor_admin_id has no foreign key, so it survives an admin's deletion)
-- ---------------------------------------------------------------------------------------
create table public.admin_message_events (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.admin_messages (id) on delete restrict,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_admin_id uuid,
  actor_email text,
  at timestamptz not null default now(),
  constraint admin_message_events_event_check check (event in ('created', 'prepared', 'test_sent', 'submitted', 'approved', 'rejected', 'send_started', 'send_finished', 'cancelled', 'flag_stopped', 'claim_resolved', 'resumed')),
  -- The detail has a closed key list and never holds an address.
  constraint admin_message_events_detail_check check (jsonb_typeof(detail) = 'object' and (detail - array['kind_confirmed', 'resolution']) = '{}'::jsonb and position('@' in detail::text) = 0)
);

create index admin_message_events_message_id_idx on public.admin_message_events (message_id);

-- ---------------------------------------------------------------------------------------
-- notification_settings and notification_setting_changes: the two send limits and their append-only change log
-- ---------------------------------------------------------------------------------------
create table public.notification_settings (
  key text primary key,
  int_value integer not null,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  constraint notification_settings_key_check check (key in ('mass_email_cap_24h', 'mass_email_ceiling_month')),
  constraint notification_settings_value_check check (int_value >= 0)
);

insert into public.notification_settings (key, int_value) values ('mass_email_cap_24h', 50), ('mass_email_ceiling_month', 2000);

create table public.notification_setting_changes (
  id uuid primary key default gen_random_uuid(),
  key text not null references public.notification_settings (key),
  old_value integer,
  new_value integer not null,
  actor_admin_id uuid,
  actor_email text,
  at timestamptz not null default now(),
  constraint notification_setting_changes_values_check check (new_value >= 0 and (old_value is null or old_value >= 0))
);

-- ---------------------------------------------------------------------------------------
-- Triggers (internal functions, never callable by a client role)
-- ---------------------------------------------------------------------------------------
create function public.notification_guard_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard_append$
begin
  raise exception 'this table is append-only' using errcode = '42501';
end
$guard_append$;

create function public.notification_guard_message_edit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard_edit$
begin
  if old.status <> 'draft' and (
       new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.link_path is distinct from old.link_path
    or new.channels is distinct from old.channels
    or new.segment_key is distinct from old.segment_key
    or new.segment_params is distinct from old.segment_params
    or new.consent_line is distinct from old.consent_line
    or new.kind is distinct from old.kind
  ) then
    raise exception 'a message cannot be edited after it leaves draft' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  return new;
end
$guard_edit$;

revoke all on function public.notification_guard_append_only() from public, anon, authenticated, service_role;
revoke all on function public.notification_guard_message_edit() from public, anon, authenticated, service_role;

create trigger admin_message_events_append_only_row
  before update or delete on public.admin_message_events
  for each row execute function public.notification_guard_append_only();
create trigger admin_message_events_append_only_truncate
  before truncate on public.admin_message_events
  for each statement execute function public.notification_guard_append_only();
create trigger notification_setting_changes_append_only_row
  before update or delete on public.notification_setting_changes
  for each row execute function public.notification_guard_append_only();
create trigger notification_setting_changes_append_only_truncate
  before truncate on public.notification_setting_changes
  for each statement execute function public.notification_guard_append_only();

create trigger admin_messages_guard_edit
  before update on public.admin_messages
  for each row execute function public.notification_guard_message_edit();

-- ---------------------------------------------------------------------------------------
-- Row security: on for all seven. Only push_subscriptions has policies (a person's own devices).
-- ---------------------------------------------------------------------------------------
alter table public.notification_deliveries enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.admin_messages enable row level security;
alter table public.admin_message_recipients enable row level security;
alter table public.admin_message_events enable row level security;
alter table public.notification_settings enable row level security;
alter table public.notification_setting_changes enable row level security;

create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------
-- Grants: revoke everything from every client role, then give exactly what is needed.
-- ---------------------------------------------------------------------------------------
revoke all on table public.notification_deliveries from public, anon, authenticated, service_role;
revoke all on table public.push_subscriptions from public, anon, authenticated, service_role;
revoke all on table public.admin_messages from public, anon, authenticated, service_role;
revoke all on table public.admin_message_recipients from public, anon, authenticated, service_role;
revoke all on table public.admin_message_events from public, anon, authenticated, service_role;
revoke all on table public.notification_settings from public, anon, authenticated, service_role;
revoke all on table public.notification_setting_changes from public, anon, authenticated, service_role;

grant select, insert, update, delete on public.notification_deliveries to service_role;

grant select, insert, update, delete on public.push_subscriptions to service_role;
-- A person reads five columns of their own devices and deletes them by id. The endpoint, the keys, user_id and the time zone are never readable by a client.
grant delete on public.push_subscriptions to authenticated;
grant select (id, ua_short, created_at, last_seen_at, revoked_at) on public.push_subscriptions to authenticated;

grant select, insert, update, delete on public.admin_messages to service_role;
grant select, insert, update, delete on public.admin_message_recipients to service_role;

-- Append-only tables: read and add, nothing else.
grant select, insert on public.admin_message_events to service_role;
grant select, insert on public.notification_setting_changes to service_role;

-- The settings are written only through a later function that logs the change; the table itself is read-only to the service role.
grant select on public.notification_settings to service_role;

-- ---------------------------------------------------------------------------------------
-- Functions on the ledger (part 2). All service-role only; the quiet-hours predicate is internal and executable by nobody.
--
-- STALE-CLAIM POLICY (stated here as the prompt requires, and tested):
--   * E-mail is at-most-once. A claim left open after a crash (no sent_at, no released_at) is NEVER released by any function, job or retry: release_notification refuses an e-mail claim,
--     prune_notification_deliveries never deletes an e-mail row or an open claim, and a retry meets already_claimed. Only resolve_stale_claim, which needs the user_messaging permission
--     and writes an audit event, can mark such a claim sent or release it for retry. A human decides.
--   * Push. A definitive failure is released with a reason from a closed list. An unknown outcome leaves the claim open; it is not re-sent and it ages out of the budget window by itself.
--
-- ERRORS carry a generic message per class and never an argument value; the reason travels in the HINT. 22023 invalid parameter, 42501 permission denied, P0001 operation refused.
-- TIME comes from now() only. No function takes the time as an argument and none has a clock helper; the quiet-hours rule lives in ONE predicate that takes the instant and the zone.
-- ---------------------------------------------------------------------------------------

-- The quiet-hours predicate: the local time in the zone is 22:00 or later, or before 07:00. NOT strict: a null instant, a null zone and a zone that is not in pg_timezone_names all raise
-- 22023, so a caller can never read "null" as "not quiet".
create function public.notification_in_quiet_hours(p_instant timestamptz, p_zone text)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $quiet$
declare
  v_local time;
begin
  if p_instant is null or p_zone is null or not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = p_zone) then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  v_local := (p_instant at time zone p_zone)::time;
  return v_local >= time '22:00' or v_local < time '07:00';
end
$quiet$;

-- The claim. A device belongs to a PUSH claim only: an in-app or e-mail claim ignores p_device and stores none (N1-R29), so one event is one e-mail claim whatever device id a caller passes.
-- Decides the budget from the kind (never from the caller), takes the advisory lock its counter needs, then ONE statement finds the first failing check in the contract's fixed
-- order and inserts only when none fails. A unique violation on the open-claim key (the same claim made at the same moment by someone else) is reported as already_claimed.
create function public.claim_notification(
  p_user uuid,
  p_kind text,
  p_subject uuid,
  p_channel text,
  p_device uuid default null,
  p_window interval default interval '24 hours'
)
returns table (id uuid, refused text)
language plpgsql
security definer
set search_path = ''
as $claim$
declare
  v_admin boolean;
  v_cap integer;
  v_id uuid;
  v_refused text;
begin
  if p_user is null or p_kind is null or p_subject is null or p_channel is null or p_window is null
     or p_kind not in ('new_applicant', 'application_viewed', 'match_alert', 'admin_message')
     or p_channel not in ('inapp', 'push', 'email')
     or p_window < interval '0 seconds' then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;

  v_admin := p_kind = 'admin_message';
  v_cap := case when v_admin then 1 else 3 end;

  if p_channel = 'push' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user::text, 0));
  elsif p_channel = 'email' and v_admin then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mass_email_cap', 0));
  end if;

  with chk as (
    select case
      when p_channel = 'push' and not exists (
             select 1 from public.push_subscriptions d where d.id = p_device and d.user_id = p_user and d.revoked_at is null)
        then 'device_unavailable'
      when p_channel = 'push' and public.notification_in_quiet_hours(now(), (select d.timezone from public.push_subscriptions d where d.id = p_device))
        then 'quiet_hours'
      when p_channel = 'push' and (
             select count(*)
               from (select distinct c.kind, c.subject_id
                       from public.notification_deliveries c
                      where c.user_id = p_user and c.channel = 'push' and c.released_at is null
                        and c.claimed_at > now() - p_window
                        and (c.kind = 'admin_message') = v_admin
                        and not (c.kind = p_kind and c.subject_id = p_subject)) e) >= v_cap
        then 'budget_cap'
      when p_channel = 'email' and v_admin and (
             select count(*) from public.notification_deliveries c
              where c.channel = 'email' and c.kind = 'admin_message' and c.released_at is null and c.claimed_at > now() - interval '24 hours')
           >= coalesce((select s.int_value from public.notification_settings s where s.key = 'mass_email_cap_24h'), 0)
        then 'cap_24h'
      when p_channel = 'email' and v_admin and (
             select count(*) from public.notification_deliveries c
              where c.channel = 'email' and c.kind = 'admin_message' and c.released_at is null
                and c.claimed_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'))
           >= coalesce((select s.int_value from public.notification_settings s where s.key = 'mass_email_ceiling_month'), 0)
        then 'ceiling_month'
    end as refused
  ),
  ins as (
    insert into public.notification_deliveries as nd (user_id, kind, subject_id, device_id, channel)
    select p_user, p_kind, p_subject, case when p_channel = 'push' then p_device end, p_channel from chk where chk.refused is null
    on conflict do nothing
    returning nd.id
  )
  select (select ins.id from ins), (select chk.refused from chk) into v_id, v_refused;

  if v_id is null and v_refused is null then
    v_refused := 'already_claimed';
  end if;
  return query select v_id, v_refused;
end
$claim$;

-- Release: a push claim whose send definitively failed, with a reason from the closed list. Unknown id P0001/unknown_id first, then an e-mail claim 42501/email_release_refused, then an
-- unknown reason 22023/invalid_release_reason. Releasing a released claim keeps the first release time.
create function public.release_notification(p_id uuid, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $release$
declare
  v_channel text;
begin
  select d.channel into v_channel from public.notification_deliveries d where d.id = p_id;
  if not found then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'unknown_id';
  end if;
  if v_channel = 'email' then
    raise exception 'permission denied' using errcode = '42501', hint = 'email_release_refused';
  end if;
  if p_reason is null or p_reason not in ('gone', 'rejected_413', 'retries_exhausted', 'our_key', 'pre_send_failure') then
    raise exception 'invalid parameter' using errcode = '22023', hint = 'invalid_release_reason';
  end if;
  update public.notification_deliveries d set released_at = now() where d.id = p_id and d.released_at is null;
end
$release$;

create function public.mark_notification_sent(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $mark$
begin
  update public.notification_deliveries d set sent_at = coalesce(d.sent_at, now()) where d.id = p_id;
  if not found then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'not_found';
  end if;
end
$mark$;

-- Open claims of one channel strictly older than the limit: ids, kind, channel and time. No user and no address.
create function public.stale_notification_claims(p_channel text, p_older_than interval)
returns table (id uuid, kind text, channel text, claimed_at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $stale$
begin
  if p_older_than is null or p_older_than < interval '0 seconds' then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  return query
    select d.id, d.kind, d.channel, d.claimed_at
      from public.notification_deliveries d
     where d.channel = p_channel and d.sent_at is null and d.released_at is null and d.claimed_at < now() - p_older_than
     order by d.claimed_at, d.id;
end
$stale$;

-- The ONLY way an e-mail claim is ever finished by hand. The actor needs the user_messaging permission, read at call time; a null or unknown actor is 42501. Writes one audit event.
create function public.resolve_stale_claim(p_id uuid, p_actor uuid, p_resolution text)
returns void
language plpgsql
security definer
set search_path = ''
as $resolve$
declare
  v_kind text;
  v_subject uuid;
  v_sent timestamptz;
  v_released timestamptz;
  v_email text;
begin
  if p_actor is null or not public.admin_has_permission(p_actor, 'user_messaging') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_resolution is null or p_resolution not in ('mark_sent', 'release_for_retry') then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  select d.kind, d.subject_id, d.sent_at, d.released_at into v_kind, v_subject, v_sent, v_released
    from public.notification_deliveries d where d.id = p_id for update;
  if not found then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_sent is not null or v_released is not null then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  if p_resolution = 'mark_sent' then
    update public.notification_deliveries d set sent_at = now() where d.id = p_id;
  else
    update public.notification_deliveries d set released_at = now() where d.id = p_id;
  end if;
  select u.email into v_email from public.admin_users u where u.id = p_actor;
  insert into public.admin_message_events (message_id, event, detail, actor_admin_id, actor_email)
  values (
    (select m.id from public.admin_messages m where v_kind = 'admin_message' and m.id = v_subject),
    'claim_resolved',
    jsonb_build_object('resolution', p_resolution),
    p_actor,
    v_email
  );
end
$resolve$;

create function public.unread_notification_count(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $unread$
  select count(*)::integer from public.user_notifications n where n.user_id = p_user and n.read_at is null;
$unread$;

-- Retention. Deletes FINISHED (sent or released), non-e-mail claims claimed strictly longer ago than the limit, and never a row claimed inside the current UTC calendar month, so the
-- monthly e-mail ceiling can never be undercounted. Open claims and e-mail rows are never deleted. A null limit, one below 1 or one above 36500 raises 22023 (not strict).
create function public.prune_notification_deliveries(p_older_than_days integer default 30)
returns integer
language plpgsql
security invoker
set search_path = ''
as $prune$
declare
  v_deleted integer;
begin
  if p_older_than_days is null or p_older_than_days < 1 or p_older_than_days > 36500 then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  with gone as (
    delete from public.notification_deliveries d
     where d.channel <> 'email'
       and (d.sent_at is not null or d.released_at is not null)
       and d.claimed_at < now() - pg_catalog.make_interval(days => p_older_than_days)
       and d.claimed_at < (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')
    returning 1
  )
  select count(*)::integer into v_deleted from gone;
  return v_deleted;
end
$prune$;

revoke all on function public.notification_in_quiet_hours(timestamptz, text) from public, anon, authenticated, service_role;
revoke all on function public.claim_notification(uuid, text, uuid, text, uuid, interval) from public, anon, authenticated, service_role;
revoke all on function public.release_notification(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.mark_notification_sent(uuid) from public, anon, authenticated, service_role;
revoke all on function public.stale_notification_claims(text, interval) from public, anon, authenticated, service_role;
revoke all on function public.resolve_stale_claim(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.unread_notification_count(uuid) from public, anon, authenticated, service_role;
revoke all on function public.prune_notification_deliveries(integer) from public, anon, authenticated, service_role;

grant execute on function public.claim_notification(uuid, text, uuid, text, uuid, interval) to service_role;
grant execute on function public.release_notification(uuid, text) to service_role;
grant execute on function public.mark_notification_sent(uuid) to service_role;
grant execute on function public.stale_notification_claims(text, interval) to service_role;
grant execute on function public.resolve_stale_claim(uuid, uuid, text) to service_role;
grant execute on function public.unread_notification_count(uuid) to service_role;
grant execute on function public.prune_notification_deliveries(integer) to service_role;

-- ---------------------------------------------------------------------------------------
-- Part 3: push devices, the preference columns, the stream unsubscribe and the five flags
-- ---------------------------------------------------------------------------------------

-- Preference columns on the existing email_preferences table (service-role only: 0083 revoked every client privilege, and nothing here grants one). Exactly these seven, no more. The
-- table's grant to service_role is restated explicitly so this file does not lean on the platform's default.
alter table public.email_preferences
  add column if not exists push_enabled boolean not null default false,
  add column if not exists push_new_applicant boolean not null default false,
  add column if not exists push_application_viewed boolean not null default false,
  add column if not exists push_match_alert boolean not null default false,
  add column if not exists push_promotions boolean not null default false,
  add column if not exists email_promotions boolean not null default false,
  add column if not exists email_announcements boolean not null default true;
grant select, insert, update, delete on public.email_preferences to service_role;

-- The five flags, all off. A flag row that already exists (the owner's) is left exactly as it is. A missing row means off, in every function that reads one.
insert into public.feature_flags (key, label, enabled) values
  ('notifications_master', 'Notifications: master switch', false),
  ('push_sender', 'Notifications: send push', false),
  ('admin_messaging', 'Admin messages: enabled', false),
  ('admin_promotions', 'Admin messages: promotions', false),
  ('admin_email', 'Admin messages: email', false)
on conflict (key) do nothing;

-- Register a browser device for the SIGNED-IN person (auth.uid(); there is no user argument). https only, length caps, at most ten active devices, an unknown zone name refused with 22023
-- (a missing or empty one is Africa/Lagos). An endpoint someone else holds is re-bound in place to the caller: one row per endpoint, the previous owner no longer sees it, and their ledger
-- rows are left as they were (backlog PUSH-REBIND-LEDGER-LINK-1). The person's own advisory lock makes the limit hold under concurrent registrations.
create function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text, p_timezone text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $register$
declare
  v_user uuid := auth.uid();
  v_zone text;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_endpoint is null or p_p256dh is null or p_auth is null or p_ua is null then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  if p_endpoint not like 'https://%' then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'not_https';
  end if;
  if char_length(p_endpoint) > 2048 or char_length(p_p256dh) > 256 or char_length(p_auth) > 256 or char_length(p_ua) > 40 then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'value_too_long';
  end if;
  v_zone := case when p_timezone is null or p_timezone = '' then 'Africa/Lagos' else p_timezone end;
  if char_length(v_zone) > 64 or not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = v_zone) then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 1));
  if (select count(*) from public.push_subscriptions d where d.user_id = v_user and d.revoked_at is null and d.endpoint <> p_endpoint) >= 10 then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'device_limit';
  end if;

  insert into public.push_subscriptions as d (user_id, endpoint, p256dh, auth, ua_short, timezone)
  values (v_user, p_endpoint, p_p256dh, p_auth, p_ua, v_zone)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, ua_short = excluded.ua_short, timezone = excluded.timezone,
        last_seen_at = pg_catalog.now(), revoked_at = null, revoke_reason = null
  returning d.id into v_id;
  return v_id;
end
$register$;

-- A deletion REQUEST revokes the person's active devices with the reason deleted. A trigger, not a function a caller can reach (a new RPC would change the pinned names); internal, executable
-- by nobody. It acts only when the column goes from null to a value: a later change of the date, or cancelling the request, touches nothing.
create function public.notification_revoke_devices_on_deletion_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $revoke$
begin
  update public.push_subscriptions d set revoked_at = pg_catalog.now(), revoke_reason = 'deleted' where d.user_id = new.id and d.revoked_at is null;
  return new;
end
$revoke$;

create trigger notification_revoke_devices_on_deletion_request
  after update of deletion_requested_at on public.profiles
  for each row when (old.deletion_requested_at is null and new.deletion_requested_at is not null)
  execute function public.notification_revoke_devices_on_deletion_request();

-- The unsubscribe link of a stream. Same token authorisation as email_unsubscribe (0083): the token identifies the person, service role only. An unknown or null token is matched = false and
-- no error; an unknown or null stream is 22023; a null p_subscribed is false.
create function public.email_unsubscribe_stream(p_token text, p_stream text, p_subscribed boolean default false)
returns table (matched boolean)
language plpgsql
security definer
set search_path = ''
as $unsubscribe$
declare
  v_found boolean;
begin
  if p_stream is null or p_stream not in ('announcements', 'promotions') then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  if p_stream = 'announcements' then
    update public.email_preferences e set email_announcements = coalesce(p_subscribed, false), updated_at = pg_catalog.now() where e.unsubscribe_token = p_token;
  else
    update public.email_preferences e set email_promotions = coalesce(p_subscribed, false), updated_at = pg_catalog.now() where e.unsubscribe_token = p_token;
  end if;
  v_found := found;
  return query select v_found;
end
$unsubscribe$;

revoke all on function public.register_push_subscription(text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.notification_revoke_devices_on_deletion_request() from public, anon, authenticated, service_role;
revoke all on function public.email_unsubscribe_stream(text, text, boolean) from public, anon, authenticated, service_role;

grant execute on function public.register_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.email_unsubscribe_stream(text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------------------
-- Part 4: the admin-message functions, the send limits and the eligible-recipient filter
-- ---------------------------------------------------------------------------------------
-- Every function here is called by the server with the service role, takes the acting admin's id and checks the permission INSIDE (the service role bypasses row security, and the application's own
-- permission check is code). None is strict, so a null argument reaches the body and is refused there. The messages are the three generic texts; the HINT names the reason.

-- The audience of a segment: the ids only, from the closed list of segments. Every segment leaves out a pending deletion, a QA account and anyone without a profile (it starts from profiles).
-- Unknown parameter keys are refused, a parameter a segment does not use is ignored.
create function public.resolve_admin_segment(p_key text, p_params jsonb, p_actor uuid)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $segment$
declare
  v_days integer;
  v_since date;
  v_country text;
begin
  if p_actor is null then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  if not public.admin_has_permission(p_actor, 'user_messaging') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_key is null or p_key not in ('everyone', 'seekers', 'employers', 'verified_employers', 'inactive_seekers', 'signed_up_since', 'country', 'self_test') then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  if p_params is null or jsonb_typeof(p_params) <> 'object' or (p_params - array['days', 'since', 'country']) <> '{}'::jsonb then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  if p_key = 'inactive_seekers' then
    if jsonb_typeof(p_params -> 'days') is distinct from 'number' or (p_params -> 'days') not in ('30'::jsonb, '60'::jsonb, '90'::jsonb) then
      raise exception 'invalid parameter' using errcode = '22023';
    end if;
    v_days := (p_params ->> 'days')::integer;
  elsif p_key = 'signed_up_since' then
    if jsonb_typeof(p_params -> 'since') is distinct from 'string' or (p_params ->> 'since') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'invalid parameter' using errcode = '22023';
    end if;
    begin
      v_since := (p_params ->> 'since')::date;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception 'invalid parameter' using errcode = '22023';
    end;
  elsif p_key = 'country' then
    v_country := lower(btrim(p_params ->> 'country'));
  end if;

  return query
  select p.id
    from public.profiles p
   where p.deletion_requested_at is null
     and not public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name)
     and case p_key
           when 'everyone' then true
           when 'seekers' then not exists (select 1 from public.organization_members m where m.user_id = p.id)
           when 'employers' then exists (select 1 from public.organization_members m where m.user_id = p.id)
           when 'verified_employers' then exists (select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id where m.user_id = p.id and o.verified)
           when 'inactive_seekers' then not exists (select 1 from public.organization_members m where m.user_id = p.id)
                                        and p.last_active_at is not null and p.last_active_at < pg_catalog.now() - pg_catalog.make_interval(days => v_days)
           when 'signed_up_since' then p.created_at >= (v_since::timestamp at time zone 'UTC')
           when 'country' then v_country is not null and v_country not in ('', 'other') and lower(btrim(p.country)) = v_country
           when 'self_test' then p.id = p_actor
           else false
         end
   order by p.id;
end
$segment$;

-- Prepare: in one transaction, check the permission and the flags, refuse past the daily limits and the audience limit, queue one recipient row per person with the per-channel flags decided from the
-- person's CURRENT opt-ins, freeze the count and move to prepared. The caller's audience limit never lifts the absolute one.
create function public.prepare_admin_message(p_message uuid, p_actor uuid, p_max_audience integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $prepare$
declare
  v_m public.admin_messages%rowtype;
  v_email text;
  v_limit integer;
  v_count integer;
  v_rows bigint;
begin
  if p_actor is null or not public.admin_has_permission(p_actor, 'user_messaging') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_max_audience is null or p_max_audience < 0 then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  select * into v_m from public.admin_messages m where m.id = p_message for update;
  if not found then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_m.status <> 'draft' then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  if not (coalesce((select f.enabled from public.feature_flags f where f.key = 'notifications_master'), false)
          and coalesce((select f.enabled from public.feature_flags f where f.key = 'admin_messaging'), false)
          and (v_m.kind <> 'promotion' or coalesce((select f.enabled from public.feature_flags f where f.key = 'admin_promotions'), false))
          and ('email' <> all (v_m.channels) or coalesce((select f.enabled from public.feature_flags f where f.key = 'admin_email'), false))) then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'flag_off';
  end if;
  if v_m.kind = 'promotion' and btrim(coalesce(v_m.consent_line, '')) = '' then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'consent_required';
  end if;
  if (select count(*) from public.admin_messages x where x.created_by = p_actor and x.sent_started_at > pg_catalog.now() - interval '24 hours') >= 5 then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'operator_daily_limit';
  end if;
  if (select count(*) from public.admin_messages x where x.sent_started_at > pg_catalog.now() - interval '24 hours') >= 10 then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'overall_daily_limit';
  end if;

  v_limit := least(p_max_audience, 5000);
  select count(*) into v_count from public.resolve_admin_segment(v_m.segment_key, v_m.segment_params, p_actor);
  if v_count > v_limit then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'audience_over_limit';
  end if;

  insert into public.admin_message_recipients (message_id, user_id, to_inapp, to_push, to_email)
  select v_m.id, s.id,
         'inapp' = any (v_m.channels),
         'push' = any (v_m.channels)
           and coalesce(ep.push_enabled, false)
           and (v_m.kind <> 'promotion' or coalesce(ep.push_promotions, false))
           and exists (select 1 from public.push_subscriptions d where d.user_id = s.id and d.revoked_at is null),
         'email' = any (v_m.channels)
           and (case when v_m.kind = 'promotion' then coalesce(ep.email_promotions, false) else coalesce(ep.email_announcements, false) end)
           and btrim(coalesce(p.email, '')) <> ''
           and exists (select 1 from auth.users u where u.id = s.id and u.email_confirmed_at is not null)
           and p.last_active_at is not null and p.last_active_at >= pg_catalog.now() - interval '30 days'
    from public.resolve_admin_segment(v_m.segment_key, v_m.segment_params, p_actor) as s(id)
    join public.profiles p on p.id = s.id
    left join public.email_preferences ep on ep.user_id = s.id;
  get diagnostics v_rows = row_count;
  if v_rows > v_limit then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'audience_over_limit';
  end if;

  update public.admin_messages m set audience_count = v_rows::integer, status = 'prepared' where m.id = v_m.id;
  select u.email into v_email from public.admin_users u where u.id = p_actor;
  insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values (v_m.id, 'prepared', p_actor, v_email);
  return v_rows::integer;
end
$prepare$;

create function public.submit_admin_message(p_message uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $submit$
declare
  v_status text;
  v_email text;
begin
  if p_actor is null or not public.admin_has_permission(p_actor, 'user_messaging') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select m.status into v_status from public.admin_messages m where m.id = p_message for update;
  if not found then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_status <> 'prepared' then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  update public.admin_messages m set status = 'submitted' where m.id = p_message;
  select u.email into v_email from public.admin_users u where u.id = p_actor;
  insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values (p_message, 'submitted', p_actor, v_email);
end
$submit$;

-- Approve: a different admin from the creator, who names the kind they are approving (a promotion approved as an announcement is refused). The confirmation is kept on the message and in the event.
create function public.approve_admin_message(p_message uuid, p_actor uuid, p_kind_confirmed text)
returns void
language plpgsql
security definer
set search_path = ''
as $approve$
declare
  v_m public.admin_messages%rowtype;
  v_email text;
begin
  if p_actor is null or not public.admin_has_permission(p_actor, 'user_messaging') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into v_m from public.admin_messages m where m.id = p_message for update;
  if not found then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_m.status <> 'submitted' then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  if v_m.created_by is not distinct from p_actor then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'self_approval';
  end if;
  if p_kind_confirmed is distinct from v_m.kind then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'kind_not_confirmed';
  end if;
  select u.email into v_email from public.admin_users u where u.id = p_actor;
  update public.admin_messages m
     set status = 'approved', approved_by = p_actor, approved_by_email = v_email, kind_confirmed_by_approver = p_kind_confirmed
   where m.id = p_message;
  insert into public.admin_message_events (message_id, event, detail, actor_admin_id, actor_email)
  values (p_message, 'approved', jsonb_build_object('kind_confirmed', p_kind_confirmed), p_actor, v_email);
end
$approve$;

create function public.cancel_admin_message(p_message uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $cancel$
declare
  v_status text;
  v_email text;
begin
  if p_actor is null or not public.admin_has_permission(p_actor, 'user_messaging') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select m.status into v_status from public.admin_messages m where m.id = p_message for update;
  if not found then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_status in ('sending', 'sent', 'cancelled') then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  update public.admin_messages m set status = 'cancelled' where m.id = p_message;
  select u.email into v_email from public.admin_users u where u.id = p_actor;
  insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values (p_message, 'cancelled', p_actor, v_email);
end
$cancel$;

-- Start: ONE conditional update, so a double start or a retry changes nothing and returns null. With a flag off nothing starts and the stop is recorded.
create function public.start_admin_message_send(p_message uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $start$
declare
  v_m public.admin_messages%rowtype;
  v_email text;
  v_id uuid;
begin
  if p_actor is null or not public.admin_has_permission(p_actor, 'user_messaging') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into v_m from public.admin_messages m where m.id = p_message;
  if not found then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'not_found';
  end if;
  select u.email into v_email from public.admin_users u where u.id = p_actor;
  if not (coalesce((select f.enabled from public.feature_flags f where f.key = 'notifications_master'), false)
          and coalesce((select f.enabled from public.feature_flags f where f.key = 'admin_messaging'), false)
          and (v_m.kind <> 'promotion' or coalesce((select f.enabled from public.feature_flags f where f.key = 'admin_promotions'), false))
          and ('email' <> all (v_m.channels) or coalesce((select f.enabled from public.feature_flags f where f.key = 'admin_email'), false))) then
    insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values (p_message, 'flag_stopped', p_actor, v_email);
    return null;
  end if;
  update public.admin_messages m
     set status = 'sending', sent_started_at = pg_catalog.now()
   where m.id = p_message and (m.status = 'approved' or (m.status = 'prepared' and not m.requires_approval))
  returning m.id into v_id;
  if v_id is not null then
    insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values (v_id, 'send_started', p_actor, v_email);
  end if;
  return v_id;
end
$start$;

create function public.admin_message_audit(p_actor uuid, p_message uuid default null)
returns setof public.admin_message_events
language plpgsql
security definer
set search_path = ''
as $audit$
begin
  if p_actor is null or not public.admin_has_permission(p_actor, 'user_messaging') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return query select e.* from public.admin_message_events e where p_message is null or e.message_id = p_message order by e.at, e.id;
end
$audit$;

-- A test send changes nothing about the message (so it cannot block the real send); it is only recorded.
create function public.record_admin_message_test(p_message uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $test$
declare
  v_email text;
begin
  if p_actor is null or not public.admin_has_permission(p_actor, 'user_messaging') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.admin_messages m where m.id = p_message) then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'not_found';
  end if;
  select u.email into v_email from public.admin_users u where u.id = p_actor;
  insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values (p_message, 'test_sent', p_actor, v_email);
end
$test$;

-- Only a holder of the operators permission changes a send limit. Closed keys, a bounded value; the setting and its change row are written by one statement.
create function public.set_notification_setting(p_key text, p_value integer, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $setting$
declare
  v_email text;
begin
  if p_actor is null or not public.admin_has_permission(p_actor, 'operators') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_key is null or p_key not in ('mass_email_cap_24h', 'mass_email_ceiling_month') then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'setting_key_unknown';
  end if;
  if p_value is null or p_value < 0 or p_value > 10000 then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'setting_value_out_of_range';
  end if;
  select u.email into v_email from public.admin_users u where u.id = p_actor;
  with old as (
    select s.int_value from public.notification_settings s where s.key = p_key
  ), written as (
    insert into public.notification_settings as s (key, int_value, updated_by_email, updated_at)
    values (p_key, p_value, v_email, pg_catalog.now())
    on conflict (key) do update set int_value = excluded.int_value, updated_by_email = excluded.updated_by_email, updated_at = excluded.updated_at
    returning s.key
  )
  insert into public.notification_setting_changes (key, old_value, new_value, actor_admin_id, actor_email)
  select w.key, (select o.int_value from old o), p_value, p_actor, v_email from written w;
end
$setting$;

-- Pause: called by the sender when a claim is refused by a send limit. No actor (the sender is the service role). The recipients keep their email outcome empty; nothing is dropped or failed.
create function public.pause_admin_message_send(p_message uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $pause$
declare
  v_status text;
begin
  if p_reason is null or p_reason not in ('cap_24h', 'ceiling_month') then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  select m.status into v_status from public.admin_messages m where m.id = p_message for update;
  if not found then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_status <> 'sending' then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  update public.admin_messages m set status = case p_reason when 'cap_24h' then 'paused_email_cap' else 'paused_email_ceiling' end where m.id = p_message;
end
$pause$;

-- Resume is a person's decision: the permission and the flags are checked here, the change is audited, and nothing ever resumes by itself.
create function public.resume_admin_message_send(p_message uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $resume$
declare
  v_m public.admin_messages%rowtype;
  v_email text;
begin
  if p_actor is null or not public.admin_has_permission(p_actor, 'user_messaging') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into v_m from public.admin_messages m where m.id = p_message for update;
  if not found then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'not_found';
  end if;
  if not (coalesce((select f.enabled from public.feature_flags f where f.key = 'notifications_master'), false)
          and coalesce((select f.enabled from public.feature_flags f where f.key = 'admin_messaging'), false)
          and (v_m.kind <> 'promotion' or coalesce((select f.enabled from public.feature_flags f where f.key = 'admin_promotions'), false))
          and ('email' <> all (v_m.channels) or coalesce((select f.enabled from public.feature_flags f where f.key = 'admin_email'), false))) then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'flag_off';
  end if;
  if v_m.status not in ('paused_email_cap', 'paused_email_ceiling') then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  update public.admin_messages m set status = 'sending' where m.id = p_message;
  select u.email into v_email from public.admin_users u where u.id = p_actor;
  insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values (p_message, 'resumed', p_actor, v_email);
end
$resume$;

-- The batch sender asks, at send time, which of a batch may still get this stream by e-mail: a profile, no pending deletion, not a QA account, the stream's column on, an address on the profile and a
-- confirmed address in auth. The order of the input is kept.
create function public.admin_email_eligible_recipients(p_user_ids uuid[], p_stream text)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $eligible$
begin
  if p_user_ids is null or p_stream is null or p_stream not in ('announcements', 'promotions') then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  return query
  select i.id
    from unnest(p_user_ids) with ordinality as i(id, n)
   where exists (
     select 1
       from public.profiles p
       left join public.email_preferences ep on ep.user_id = p.id
      where p.id = i.id
        and p.deletion_requested_at is null
        and not public.is_qa_account(p.email, p.first_name, p.last_name, p.referral_leaderboard_display_name)
        and (case when p_stream = 'promotions' then coalesce(ep.email_promotions, false) else coalesce(ep.email_announcements, false) end)
        and btrim(coalesce(p.email, '')) <> ''
        and exists (select 1 from auth.users u where u.id = p.id and u.email_confirmed_at is not null)
   )
   order by i.n;
end
$eligible$;

revoke all on function public.resolve_admin_segment(text, jsonb, uuid) from public, anon, authenticated, service_role;
revoke all on function public.prepare_admin_message(uuid, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.submit_admin_message(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.approve_admin_message(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.cancel_admin_message(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.start_admin_message_send(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_message_audit(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.record_admin_message_test(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.set_notification_setting(text, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.pause_admin_message_send(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.resume_admin_message_send(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_email_eligible_recipients(uuid[], text) from public, anon, authenticated, service_role;

grant execute on function public.resolve_admin_segment(text, jsonb, uuid) to service_role;
grant execute on function public.prepare_admin_message(uuid, uuid, integer) to service_role;
grant execute on function public.submit_admin_message(uuid, uuid) to service_role;
grant execute on function public.approve_admin_message(uuid, uuid, text) to service_role;
grant execute on function public.cancel_admin_message(uuid, uuid) to service_role;
grant execute on function public.start_admin_message_send(uuid, uuid) to service_role;
grant execute on function public.admin_message_audit(uuid, uuid) to service_role;
grant execute on function public.record_admin_message_test(uuid, uuid) to service_role;
grant execute on function public.set_notification_setting(text, integer, uuid) to service_role;
grant execute on function public.pause_admin_message_send(uuid, text) to service_role;
grant execute on function public.resume_admin_message_send(uuid, uuid) to service_role;
grant execute on function public.admin_email_eligible_recipients(uuid[], text) to service_role;

-- ---------------------------------------------------------------------------------------
-- Self-check (LAST statement): the grants, the column grants, row security, the policies and the trigger functions are exactly as intended. Raises on anything missing or extra.
-- ---------------------------------------------------------------------------------------
do $check$
declare
  r record;
  problems text[] := '{}';
  tables text[] := array['notification_deliveries', 'push_subscriptions', 'admin_messages', 'admin_message_recipients', 'admin_message_events', 'notification_settings', 'notification_setting_changes'];
  functions text[] := array['notification_in_quiet_hours', 'claim_notification', 'release_notification', 'mark_notification_sent', 'stale_notification_claims', 'resolve_stale_claim', 'unread_notification_count', 'prune_notification_deliveries', 'register_push_subscription', 'email_unsubscribe_stream', 'notification_revoke_devices_on_deletion_request', 'resolve_admin_segment', 'prepare_admin_message', 'submit_admin_message', 'approve_admin_message', 'cancel_admin_message', 'start_admin_message_send', 'admin_message_audit', 'record_admin_message_test', 'set_notification_setting', 'pause_admin_message_send', 'resume_admin_message_send', 'admin_email_eligible_recipients', 'notification_guard_append_only', 'notification_guard_message_edit'];
begin
  -- Table-level privileges, every type including TRUNCATE, REFERENCES, TRIGGER and MAINTAIN, for every role including PUBLIC.
  for r in
    with want(tbl, who, privs) as (values
      ('notification_deliveries', 'service_role', 'DELETE,INSERT,SELECT,UPDATE'),
      ('push_subscriptions', 'service_role', 'DELETE,INSERT,SELECT,UPDATE'),
      ('push_subscriptions', 'authenticated', 'DELETE'),
      ('admin_messages', 'service_role', 'DELETE,INSERT,SELECT,UPDATE'),
      ('admin_message_recipients', 'service_role', 'DELETE,INSERT,SELECT,UPDATE'),
      ('admin_message_events', 'service_role', 'INSERT,SELECT'),
      ('notification_settings', 'service_role', 'SELECT'),
      ('notification_setting_changes', 'service_role', 'INSERT,SELECT')
    ),
    want_rows as (select w.tbl, w.who, p as priv from want w cross join lateral unnest(string_to_array(w.privs, ',')) p),
    have_rows as (
      select c.relname::text as tbl, coalesce(g.rolname::text, 'PUBLIC') as who, a.privilege_type::text as priv
        from pg_class c
        cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        left join pg_roles g on g.oid = a.grantee
       where c.relnamespace = 'public'::regnamespace and c.relname = any (tables) and a.grantee <> c.relowner
    )
    select 'missing' as what, m.tbl, m.who, m.priv from (select * from want_rows except select * from have_rows) m
    union all
    select 'extra', x.tbl, x.who, x.priv from (select * from have_rows except select * from want_rows) x
  loop
    problems := problems || format('%s privilege %s on %s for %s', r.what, r.priv, r.tbl, r.who);
  end loop;

  -- Column-level privileges: only the five readable columns of push_subscriptions, for authenticated.
  for r in
    with want_cols(col, who, priv) as (values
      ('push_subscriptions.id', 'authenticated', 'SELECT'),
      ('push_subscriptions.ua_short', 'authenticated', 'SELECT'),
      ('push_subscriptions.created_at', 'authenticated', 'SELECT'),
      ('push_subscriptions.last_seen_at', 'authenticated', 'SELECT'),
      ('push_subscriptions.revoked_at', 'authenticated', 'SELECT')
    ),
    have_cols as (
      select c.relname::text || '.' || a.attname::text as col, coalesce(g.rolname::text, 'PUBLIC') as who, x.privilege_type::text as priv
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        cross join lateral aclexplode(a.attacl) x
        left join pg_roles g on g.oid = x.grantee
       where c.relnamespace = 'public'::regnamespace and c.relname = any (tables) and a.attnum > 0 and not a.attisdropped and a.attacl is not null
    )
    select 'missing' as what, m.col, m.who, m.priv from (select * from want_cols except select * from have_cols) m
    union all
    select 'extra', x.col, x.who, x.priv from (select * from have_cols except select * from want_cols) x
  loop
    problems := problems || format('%s column privilege %s on %s for %s', r.what, r.priv, r.col, r.who);
  end loop;

  -- Row security on for every table.
  for r in select c.relname::text as tbl from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any (tables) and not c.relrowsecurity loop
    problems := problems || format('row security is off on %s', r.tbl);
  end loop;

  -- Policies: exactly the two on push_subscriptions, both for authenticated only.
  for r in
    with want_pol(tbl, pol, cmd, roles) as (values
      ('push_subscriptions', 'push_subscriptions_select_own', 'SELECT', '{authenticated}'),
      ('push_subscriptions', 'push_subscriptions_delete_own', 'DELETE', '{authenticated}')
    ),
    have_pol as (select p.tablename::text as tbl, p.policyname::text as pol, p.cmd::text as cmd, p.roles::text as roles from pg_policies p where p.schemaname = 'public' and p.tablename = any (tables))
    select 'missing' as what, m.tbl, m.pol from (select * from want_pol except select * from have_pol) m
    union all
    select 'extra', x.tbl, x.pol from (select * from have_pol except select * from want_pol) x
  loop
    problems := problems || format('%s policy %s on %s', r.what, r.pol, r.tbl);
  end loop;

  -- Every function of this migration: defined once, not strict, an empty search_path pinned, and executable by exactly the roles intended (service_role for the callable ones, nobody for
  -- the internal ones: the quiet-hours predicate and the two trigger functions).
  for r in
    with want_fn(fn, who) as (values
      ('claim_notification', 'service_role'),
      ('release_notification', 'service_role'),
      ('mark_notification_sent', 'service_role'),
      ('stale_notification_claims', 'service_role'),
      ('resolve_stale_claim', 'service_role'),
      ('unread_notification_count', 'service_role'),
      ('prune_notification_deliveries', 'service_role'),
      ('register_push_subscription', 'authenticated'),
      ('email_unsubscribe_stream', 'service_role'),
      ('resolve_admin_segment', 'service_role'),
      ('prepare_admin_message', 'service_role'),
      ('submit_admin_message', 'service_role'),
      ('approve_admin_message', 'service_role'),
      ('cancel_admin_message', 'service_role'),
      ('start_admin_message_send', 'service_role'),
      ('admin_message_audit', 'service_role'),
      ('record_admin_message_test', 'service_role'),
      ('set_notification_setting', 'service_role'),
      ('pause_admin_message_send', 'service_role'),
      ('resume_admin_message_send', 'service_role'),
      ('admin_email_eligible_recipients', 'service_role')
    ),
    have_fn as (
      select p.proname::text as fn, coalesce(g.rolname::text, 'PUBLIC') as who
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        left join pg_roles g on g.oid = a.grantee
       where p.pronamespace = 'public'::regnamespace and p.proname = any (functions) and a.grantee <> p.proowner
    )
    select 'missing' as what, m.fn, m.who from (select * from want_fn except select * from have_fn) m
    union all
    select 'extra', x.fn, x.who from (select * from have_fn except select * from want_fn) x
  loop
    problems := problems || format('%s execute on %s for %s', r.what, r.fn, r.who);
  end loop;
  for r in select f.fn from unnest(functions) f(fn) where (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.fn) <> 1 loop
    problems := problems || format('function %s is missing or defined more than once', r.fn);
  end loop;
  for r in select p.proname::text as fn from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any (functions) and (p.proisstrict or p.proconfig is distinct from array['search_path=""']) loop
    problems := problems || format('function %s is strict or does not pin an empty search_path', r.fn);
  end loop;

  -- The altered table: service_role holds select, insert, update and delete; no client role holds any privilege on it, table or column; the seven columns and the five flags exist.
  for r in select x.p from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) x(p) where not has_table_privilege('service_role', 'public.email_preferences', x.p) loop
    problems := problems || format('service_role lacks %s on email_preferences', r.p);
  end loop;
  for r in
    select coalesce(g.rolname::text, 'PUBLIC') as who, a.privilege_type::text as priv
      from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      left join pg_roles g on g.oid = a.grantee
     where c.oid = 'public.email_preferences'::regclass and a.grantee <> c.relowner and (a.grantee = 0 or g.rolname in ('anon', 'authenticated'))
  loop
    problems := problems || format('extra privilege %s on email_preferences for %s', r.priv, r.who);
  end loop;
  for r in
    select a.attname::text as col, coalesce(g.rolname::text, 'PUBLIC') as who
      from pg_attribute a
      cross join lateral aclexplode(a.attacl) x
      left join pg_roles g on g.oid = x.grantee
     where a.attrelid = 'public.email_preferences'::regclass and a.attacl is not null and (x.grantee = 0 or g.rolname in ('anon', 'authenticated'))
  loop
    problems := problems || format('extra column privilege on email_preferences.%s for %s', r.col, r.who);
  end loop;
  for r in
    select k.col from unnest(array['push_enabled', 'push_new_applicant', 'push_application_viewed', 'push_match_alert', 'push_promotions', 'email_promotions', 'email_announcements']) k(col)
     where not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'email_preferences' and c.column_name = k.col and c.data_type = 'boolean' and c.is_nullable = 'NO')
  loop
    problems := problems || format('email_preferences.%s is missing or not a boolean NOT NULL', r.col);
  end loop;
  for r in
    select k.flag from unnest(array['notifications_master', 'push_sender', 'admin_messaging', 'admin_promotions', 'admin_email']) k(flag)
     where not exists (select 1 from public.feature_flags f where f.key = k.flag)
  loop
    problems := problems || format('flag %s is missing', r.flag);
  end loop;

  -- One notice per object, read back from the catalog.
  for r in
    select t.table_name::text as tbl, string_agg(t.grantee::text || ':' || t.privilege_type::text, ' ' order by t.grantee, t.privilege_type) as granted
      from information_schema.role_table_grants t
     where t.table_schema = 'public' and t.table_name = any (tables) and t.grantee <> 'postgres'
     group by t.table_name
     order by t.table_name
  loop
    raise notice '0265 grants on %: %', r.tbl, r.granted;
  end loop;

  if array_length(problems, 1) is not null then
    raise exception '0265 self-check: %', array_to_string(problems, '; ');
  end if;
  raise notice '0265 self-check: ok';
end
$check$;
