-- Rollback of 0273 (N1B): restores the 0265 state exactly. Functions that 0273 replaced get their 0265 text back, the functions it added are dropped, and the privileges it narrowed are granted again.
-- Every statement is "if exists" or idempotent, so the file runs cleanly where 0273 was never applied and can be run twice. Nothing of 0265 is dropped; no row is touched.

drop function if exists public.create_admin_message(uuid, text, text, text, text, text[], text, jsonb, text, boolean);
drop function if exists public.record_admin_message_progress(uuid, integer, integer, integer);
drop function if exists public.finish_admin_message_send(uuid);

-- The 0265 text comes back only where 0265's tables exist (on a database without them there is nothing to restore).
do $restore$
begin
  if to_regclass('public.admin_messages') is not null and to_regclass('public.notification_deliveries') is not null then
    execute $f$create or replace function public.approve_admin_message(p_message uuid, p_actor uuid, p_kind_confirmed text)
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
$approve$;$f$;
    execute $f$create or replace function public.notification_guard_message_edit()
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
$guard_edit$;$f$;
    execute $f$create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text, p_timezone text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $register$
declare
  v_user uuid := auth.uid();
  v_zone text;
  v_id uuid;
  v_old_id uuid;
  v_old_user uuid;
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

  -- One writer per endpoint at a time, so two people registering the same endpoint cannot race into the unique key.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_endpoint, 2));
  select d.id, d.user_id into v_old_id, v_old_user from public.push_subscriptions d where d.endpoint = p_endpoint for update;
  if found and v_old_user = v_user then
    -- the caller's own device registering again: refreshed in place, and revived if it had been revoked
    update public.push_subscriptions d
       set p256dh = p_p256dh, auth = p_auth, ua_short = p_ua, timezone = v_zone, last_seen_at = pg_catalog.now(), revoked_at = null, revoke_reason = null
     where d.id = v_old_id;
    return v_old_id;
  end if;
  if found then
    -- Someone else holds this endpoint. Their row is NOT moved: it is revoked and its endpoint and keys are made unusable, so its history (ledger rows point at it) stays with them,
    -- and the caller gets a new row of their own.
    update public.push_subscriptions d
       set revoked_at = pg_catalog.now(), revoke_reason = 'user', endpoint = 'https://revoked.invalid/' || d.id::text, p256dh = 'revoked', auth = 'revoked'
     where d.id = v_old_id;
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, ua_short, timezone)
  values (v_user, p_endpoint, p_p256dh, p_auth, p_ua, v_zone)
  returning id into v_id;
  return v_id;
end
$register$;$f$;
    execute $f$create or replace function public.prepare_admin_message(p_message uuid, p_actor uuid, p_max_audience integer)
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

  -- A promotion, or an audience of more than 100, always needs a second person's approval; a message that already needed it keeps needing it (this only ever raises the flag).
  update public.admin_messages m
     set audience_count = v_rows::integer, status = 'prepared', requires_approval = m.requires_approval or v_m.kind = 'promotion' or v_rows > 100
   where m.id = v_m.id;
  select u.email into v_email from public.admin_users u where u.id = p_actor;
  insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values (v_m.id, 'prepared', p_actor, v_email);
  return v_rows::integer;
end
$prepare$;$f$;
    execute $f$create or replace function public.start_admin_message_send(p_message uuid, p_actor uuid)
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
    -- one stop event per message until something else happens to it (not one per call): an append-only table must not grow by being asked again
    if not exists (
      select 1 from public.admin_message_events e
       where e.message_id = p_message and e.event = 'flag_stopped'
         and e.at >= coalesce((select max(x.at) from public.admin_message_events x where x.message_id = p_message and x.event <> 'flag_stopped'), '-infinity'::timestamptz)
    ) then
      insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values (p_message, 'flag_stopped', p_actor, v_email);
    end if;
    return null;
  end if;
  -- The daily send limits count messages that have STARTED, so they are checked here too, under one lock, with the same counts as prepare: a message that cannot start now is refused with the
  -- reason, and a message that is not startable at all (any state but approved, or prepared without approval) is answered with null before the limits are looked at.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_send_limits', 0));
  if exists (select 1 from public.admin_messages m where m.id = p_message and (m.status = 'approved' or (m.status = 'prepared' and not m.requires_approval))) then
    if v_m.created_by is not null
       and (select count(*) from public.admin_messages x where x.created_by = v_m.created_by and x.sent_started_at > pg_catalog.now() - interval '24 hours') >= 5 then
      raise exception 'operation refused' using errcode = 'P0001', hint = 'operator_daily_limit';
    end if;
    if (select count(*) from public.admin_messages x where x.sent_started_at > pg_catalog.now() - interval '24 hours') >= 10 then
      raise exception 'operation refused' using errcode = 'P0001', hint = 'overall_daily_limit';
    end if;
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
$start$;$f$;
    alter table public.admin_message_events drop constraint if exists admin_message_events_flag_state_check;
    alter table public.admin_message_events drop column if exists flag_state;
    grant select, insert, update, delete on public.admin_messages to service_role;
    grant insert on public.admin_message_events to service_role;
    revoke update (push_outcome, email_outcome) on public.admin_message_recipients from service_role;
    grant select, insert, update, delete on public.admin_message_recipients to service_role;
    grant insert, update, delete on public.notification_deliveries to service_role;
  end if;
end
$restore$;
