-- 0265 (part 1): the notification ledger, push devices, admin messaging and the two send limits.
--
-- Seven tables, their constraints, row security, explicit least-privilege grants and a grants self-check that is the LAST statement of this file. Functions come in later parts of
-- this migration and are placed above the self-check.
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
-- Self-check (LAST statement): the grants, the column grants, row security, the policies and the trigger functions are exactly as intended. Raises on anything missing or extra.
-- ---------------------------------------------------------------------------------------
do $check$
declare
  r record;
  problems text[] := '{}';
  tables text[] := array['notification_deliveries', 'push_subscriptions', 'admin_messages', 'admin_message_recipients', 'admin_message_events', 'notification_settings', 'notification_setting_changes'];
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

  -- The two trigger functions are callable by nobody but their owner.
  for r in
    select p.proname::text as fn, coalesce(g.rolname::text, 'PUBLIC') as who
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      left join pg_roles g on g.oid = a.grantee
     where p.pronamespace = 'public'::regnamespace and p.proname in ('notification_guard_append_only', 'notification_guard_message_edit') and a.grantee <> p.proowner
  loop
    problems := problems || format('extra execute on %s for %s', r.fn, r.who);
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
