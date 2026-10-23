-- 0273 (N1B): the follow-up to 0265. It is applied AFTER 0265 and BEFORE any notification flag goes on (rulings N1B-R1 to N1B-R10). It only replaces functions, adds functions and narrows
-- privileges: it never drops a table, a column or a row of 0265, so it applies cleanly on an empty or a populated 0265.
--
-- PART A (this part): F2 and F3 and the ledger grants.
--   F2  The two-person rule no longer rests on a column the caller writes. create_admin_message is the only way to make a message: it sets created_by and created_by_email itself from the acting
--       admin and writes the `created` event. approve_admin_message refuses an actor who is created_by OR the actor of the `created` event; the preparer and the submitter are NOT excluded
--       (a two-operator team must be able to finish a message). A message with no created_by and no `created` event cannot be approved (independence cannot be shown). The actor is still the
--       argument p_actor; the application must take it from the verified admin session only (backlog N1B-ACTOR-FROM-SESSION-1).
--   F3  The service role can no longer write the messages, their audit rows or the ledger by table: INSERT, UPDATE and DELETE on admin_messages and notification_deliveries are revoked,
--       INSERT on admin_message_events is revoked, and on admin_message_recipients only the two outcome columns can be updated. Every write goes through a definer function. The edit
--       guard now also enforces the legal status graph and freezes the approval fields. Two provisional, minimal functions give the sender its counters (record_admin_message_progress) and the
--       end of a send (finish_admin_message_send); the sender migration may add more (backlog N1B-SENDER-WRITE-LIST-1).
--
-- LEGAL STATUS MOVES, each with the function that makes it (anything else is refused by the guard):
--   draft -> prepared                        prepare_admin_message
--   prepared -> submitted                    submit_admin_message
--   submitted -> approved                    approve_admin_message
--   approved -> sending                      start_admin_message_send
--   prepared -> sending (no approval needed) start_admin_message_send
--   sending -> paused_email_cap / paused_email_ceiling   pause_admin_message_send
--   paused_email_cap / paused_email_ceiling -> sending   resume_admin_message_send
--   sending -> sent                          finish_admin_message_send
--   draft / prepared / submitted / approved / paused_email_cap / paused_email_ceiling -> cancelled   cancel_admin_message
--
-- FUNCTION KINDS: unchanged from 0265 (N1-R33). Every function is a SECURITY DEFINER with an empty search_path, not STRICT, never IMMUTABLE, executable only by the role it is pinned to, except the
-- three allow-listed invoker functions: notification_guard_append_only, notification_guard_message_edit and notification_in_quiet_hours.
-- This file has no transaction control: the migration runner wraps it.

-- ---------------------------------------------------------------------------------------
-- F2: create_admin_message, the only way to make a message
-- ---------------------------------------------------------------------------------------
create function public.create_admin_message(
  p_actor uuid, p_kind text, p_title text, p_body text, p_link_path text, p_channels text[], p_segment_key text, p_segment_params jsonb, p_consent_line text, p_requires_approval boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $create$
declare
  v_email text;
  v_id uuid;
begin
  if p_actor is null or not public.admin_has_permission(p_actor, 'user_messaging') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_requires_approval is null then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  select u.email into v_email from public.admin_users u where u.id = p_actor;
  begin
    insert into public.admin_messages (created_by, created_by_email, kind, title, body, link_path, channels, segment_key, segment_params, consent_line, requires_approval)
    values (p_actor, v_email, p_kind, p_title, p_body, p_link_path, p_channels, p_segment_key, coalesce(p_segment_params, '{}'::jsonb), p_consent_line, p_requires_approval)
    returning id into v_id;
  exception when check_violation or not_null_violation then
    -- a bad value is a caller error, and the error carries none of the values
    raise exception 'invalid parameter' using errcode = '22023';
  end;
  insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email) values (v_id, 'created', p_actor, v_email);
  return v_id;
end
$create$;

-- ---------------------------------------------------------------------------------------
-- F2: approve_admin_message, with the independence rule
-- ---------------------------------------------------------------------------------------
create or replace function public.approve_admin_message(p_message uuid, p_actor uuid, p_kind_confirmed text)
returns void
language plpgsql
security definer
set search_path = ''
as $approve$
declare
  v_m public.admin_messages%rowtype;
  v_email text;
  v_created_event boolean;
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
  -- Independence: the approver is not the creator of the row, and not the actor of the `created` event (events keep the actor id when an admin is deleted). Nobody else is excluded.
  select exists (select 1 from public.admin_message_events e where e.message_id = p_message and e.event = 'created') into v_created_event;
  if v_m.created_by is not distinct from p_actor
     or exists (select 1 from public.admin_message_events e where e.message_id = p_message and e.event = 'created' and e.actor_admin_id = p_actor)
     or (v_m.created_by is null and not v_created_event) then
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

-- ---------------------------------------------------------------------------------------
-- F3: the sender's two provisional writers
-- ---------------------------------------------------------------------------------------
-- Adds to the three counters of a message that is being sent (or is paused). Never subtracts, never takes a negative or a missing value, and no counter can pass the audience times the number
-- of channels (a person can be counted once per channel). No actor: the sender is the service role.
create function public.record_admin_message_progress(p_message uuid, p_sent integer, p_failed integer, p_skipped integer)
returns void
language plpgsql
security definer
set search_path = ''
as $progress$
declare
  v_m public.admin_messages%rowtype;
  v_cap bigint;
begin
  if p_sent is null or p_failed is null or p_skipped is null or p_sent < 0 or p_failed < 0 or p_skipped < 0 then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  select * into v_m from public.admin_messages m where m.id = p_message for update;
  if not found then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_m.status not in ('sending', 'paused_email_cap', 'paused_email_ceiling') then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  v_cap := v_m.audience_count::bigint * cardinality(v_m.channels);
  if v_m.sent_count::bigint + p_sent > v_cap or v_m.failed_count::bigint + p_failed > v_cap or v_m.skipped_count::bigint + p_skipped > v_cap then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;
  update public.admin_messages m
     set sent_count = m.sent_count + p_sent, failed_count = m.failed_count + p_failed, skipped_count = m.skipped_count + p_skipped
   where m.id = p_message;
end
$progress$;

-- The end of a send: sending -> sent, and the send_finished event.
create function public.finish_admin_message_send(p_message uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $finish$
declare
  v_status text;
begin
  select m.status into v_status from public.admin_messages m where m.id = p_message for update;
  if not found then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_status <> 'sending' then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  update public.admin_messages m set status = 'sent' where m.id = p_message;
  insert into public.admin_message_events (message_id, event) values (p_message, 'send_finished');
end
$finish$;

-- ---------------------------------------------------------------------------------------
-- F3: the edit guard, now also the status graph and the frozen fields
-- ---------------------------------------------------------------------------------------
create or replace function public.notification_guard_message_edit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $guard_edit$
declare
  v_move text := old.status || '>' || new.status;
begin
  -- the content of a message is frozen once it leaves draft (unchanged)
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

  -- who made it and who approved it: never rewritten. The only change allowed is a deleted admin's id being cleared by the foreign key (the e-mail snapshot stays).
  if new.created_by_email is distinct from old.created_by_email
     or (new.created_by is distinct from old.created_by and new.created_by is not null)
     or (new.approved_by is distinct from old.approved_by and new.approved_by is not null and v_move <> 'submitted>approved')
     or (new.approved_by_email is distinct from old.approved_by_email and v_move <> 'submitted>approved')
     or (new.kind_confirmed_by_approver is distinct from old.kind_confirmed_by_approver and v_move <> 'submitted>approved') then
    raise exception 'a message cannot be edited after it leaves draft' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  -- the approval requirement can only be raised, and only while the message is prepared (or still a draft)
  if new.requires_approval is distinct from old.requires_approval
     and not ((old.status = 'draft' and new.status in ('draft', 'prepared')) and (new.requires_approval or new.status = 'draft')) then
    raise exception 'a message cannot be edited after it leaves draft' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  -- the frozen audience count is set once, when the message is prepared
  if new.audience_count is distinct from old.audience_count and not (old.status = 'draft' and new.status in ('draft', 'prepared')) then
    raise exception 'a message cannot be edited after it leaves draft' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  -- the counters only grow, and only while a send is running or paused or ending
  if (new.sent_count < old.sent_count or new.failed_count < old.failed_count or new.skipped_count < old.skipped_count)
     or ((new.sent_count, new.failed_count, new.skipped_count) is distinct from (old.sent_count, old.failed_count, old.skipped_count) and old.status not in ('sending', 'paused_email_cap', 'paused_email_ceiling')) then
    raise exception 'a message cannot be edited after it leaves draft' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  -- the start time is written once, by the move into sending
  if new.sent_started_at is distinct from old.sent_started_at and not (new.status = 'sending' and old.status in ('approved', 'prepared')) then
    raise exception 'a message cannot be edited after it leaves draft' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  -- the status graph
  if new.status is distinct from old.status and not (
       v_move in ('draft>prepared', 'prepared>submitted', 'submitted>approved', 'approved>sending', 'sending>paused_email_cap', 'sending>paused_email_ceiling',
                  'paused_email_cap>sending', 'paused_email_ceiling>sending', 'sending>sent',
                  'draft>cancelled', 'prepared>cancelled', 'submitted>cancelled', 'approved>cancelled', 'paused_email_cap>cancelled', 'paused_email_ceiling>cancelled')
       or (v_move = 'prepared>sending' and not old.requires_approval)
     ) then
    raise exception 'a message cannot move between these states' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  return new;
end
$guard_edit$;

-- ---------------------------------------------------------------------------------------
-- F3 and the ledger: privileges
-- ---------------------------------------------------------------------------------------
revoke insert, update, delete on public.admin_messages from service_role;
revoke insert on public.admin_message_events from service_role;
revoke insert, update, delete on public.admin_message_recipients from service_role;
grant update (push_outcome, email_outcome) on public.admin_message_recipients to service_role;
revoke insert, update, delete on public.notification_deliveries from service_role;

revoke all on function public.create_admin_message(uuid, text, text, text, text, text[], text, jsonb, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.record_admin_message_progress(uuid, integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.finish_admin_message_send(uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_admin_message(uuid, text, text, text, text, text[], text, jsonb, text, boolean) to service_role;
grant execute on function public.record_admin_message_progress(uuid, integer, integer, integer) to service_role;
grant execute on function public.finish_admin_message_send(uuid) to service_role;

-- ---------------------------------------------------------------------------------------
-- Part B-1: register_push_subscription. F4 host allow-list; a take-over keeps the previous owner's first revoke reason and time (a row revoked as deleted stays deleted, at its own time).
-- ---------------------------------------------------------------------------------------
create or replace function public.register_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ua text, p_timezone text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $register$
declare
  v_user uuid := auth.uid();
  v_zone text;
  v_host text;
  v_endpoint text;
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
  -- F4: the endpoint must point at a real push service. No whitespace, control character or backslash anywhere (a parser that reads a backslash as a slash would find another host);
  -- the host is the text after https:// up to the first / ? or #, lower-cased, letters digits dots and hyphens only (so no user info, no port, no percent-escape, no bracket, no trailing dot), and then
  -- either one of the exact hosts or a name under one of the suffixes. The list is PUSH_ENDPOINT_HOSTS in the contract; a test keeps the two equal.
  v_host := pg_catalog.lower(substring(p_endpoint from '^https://([^/?#]*)'));
  -- The endpoint is stored with its host lower-cased (the host is ASCII by the rule below, so the lengths are equal) and the rest as typed: two spellings of one host are one endpoint, for the
  -- unique key, the take-over lookup, the endpoint lock and the device count alike.
  v_endpoint := 'https://' || v_host || substring(p_endpoint from 9 + char_length(v_host));
  if p_endpoint ~ '[[:space:][:cntrl:]\\]'
     or v_host is null or v_host !~ '^[a-z0-9.-]+$'
     or not (v_host = any (array['fcm.googleapis.com', 'updates.push.services.mozilla.com'])
             or exists (select 1 from pg_catalog.unnest(array['push.apple.com', 'notify.windows.com']) s(suffix) where v_host like '%.' || s.suffix)) then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'host_not_allowed';
  end if;
  v_zone := case when p_timezone is null or p_timezone = '' then 'Africa/Lagos' else p_timezone end;
  if char_length(v_zone) > 64 or not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = v_zone) then
    raise exception 'invalid parameter' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 1));
  if (select count(*) from public.push_subscriptions d where d.user_id = v_user and d.revoked_at is null and d.endpoint <> v_endpoint) >= 10 then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'device_limit';
  end if;

  -- One writer per endpoint at a time, so two people registering the same endpoint cannot race into the unique key.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_endpoint, 2));
  select d.id, d.user_id into v_old_id, v_old_user from public.push_subscriptions d where d.endpoint = v_endpoint for update;
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
       set revoked_at = coalesce(d.revoked_at, pg_catalog.now()), revoke_reason = coalesce(d.revoke_reason, 'user'), endpoint = 'https://revoked.invalid/' || d.id::text, p256dh = 'revoked', auth = 'revoked'
     where d.id = v_old_id;
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, ua_short, timezone)
  values (v_user, v_endpoint, p_p256dh, p_auth, p_ua, v_zone)
  returning id into v_id;
  return v_id;
end
$register$;

-- ---------------------------------------------------------------------------------------
-- Part B-2: F8 the stop event records which flags were off; the daily per-operator limit counts by the creator's address.
-- ---------------------------------------------------------------------------------------
-- flag_state: a bitmask of the flags that were off when a send was asked for (master 1, messaging 2, promotions 4, e-mail 8), 1..15; null on events written before this column.
alter table public.admin_message_events add column flag_state smallint;
alter table public.admin_message_events add constraint admin_message_events_flag_state_check check (flag_state between 1 and 15);

-- The limit counts the creator's ADDRESS (lower-cased), not the creator's id: the id is cleared when the admin is deleted, and the address is the snapshot that stays, so deleting and re-creating
-- an admin does not reset the count. Prepare counts the acting admin's address, start counts the message creator's.
create or replace function public.prepare_admin_message(p_message uuid, p_actor uuid, p_max_audience integer)
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
  if (select count(*) from public.admin_messages x where pg_catalog.lower(x.created_by_email) = pg_catalog.lower((select u.email from public.admin_users u where u.id = p_actor)) and x.sent_started_at > pg_catalog.now() - interval '24 hours') >= 5 then
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
$prepare$;

-- Start: ONE conditional update, so a double start or a retry changes nothing and returns null. With a flag off nothing starts and the stop is recorded (F8: once per set of flags that were off).
create or replace function public.start_admin_message_send(p_message uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $start$
declare
  v_m public.admin_messages%rowtype;
  v_email text;
  v_id uuid;
  v_state integer;
  v_last smallint;
  v_seen boolean;
begin
  if p_actor is null or not public.admin_has_permission(p_actor, 'user_messaging') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select * into v_m from public.admin_messages m where m.id = p_message;
  if not found then
    raise exception 'operation refused' using errcode = 'P0001', hint = 'not_found';
  end if;
  select u.email into v_email from public.admin_users u where u.id = p_actor;
  -- Which flags are off, as a bitmask: master 1, messaging 2, promotions 4 (only for a promotion), e-mail 8 (only with the e-mail channel). Zero means every flag that matters is on.
  v_state := (case when coalesce((select f.enabled from public.feature_flags f where f.key = 'notifications_master'), false) then 0 else 1 end)
           + (case when coalesce((select f.enabled from public.feature_flags f where f.key = 'admin_messaging'), false) then 0 else 2 end)
           + (case when v_m.kind <> 'promotion' or coalesce((select f.enabled from public.feature_flags f where f.key = 'admin_promotions'), false) then 0 else 4 end)
           + (case when 'email' <> all (v_m.channels) or coalesce((select f.enabled from public.feature_flags f where f.key = 'admin_email'), false) then 0 else 8 end);
  if v_state > 0 then
    -- One stop event per message per set of flags that were off, until something else happens to the message (not one per call): an append-only table must not grow by being asked again, and
    -- a different set of flags is worth a new row. The message's own lock makes two sessions asking at once write one: the second waits, then sees the first's row.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_message::text, 3));
    select true, e.flag_state into v_seen, v_last
      from public.admin_message_events e
     where e.message_id = p_message and e.event = 'flag_stopped'
       and e.at >= coalesce((select max(x.at) from public.admin_message_events x where x.message_id = p_message and x.event <> 'flag_stopped'), '-infinity'::timestamptz)
     order by e.at desc, e.id desc
     limit 1;
    if not coalesce(v_seen, false) or v_last is distinct from v_state::smallint then
      insert into public.admin_message_events (message_id, event, actor_admin_id, actor_email, flag_state, at)
      values (p_message, 'flag_stopped', p_actor, v_email, v_state::smallint, pg_catalog.clock_timestamp());
    end if;
    return null;
  end if;
  -- The daily send limits count messages that have STARTED, so they are checked here too, under one lock, with the same counts as prepare: a message that cannot start now is refused with the
  -- reason, and a message that is not startable at all (any state but approved, or prepared without approval) is answered with null before the limits are looked at.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_send_limits', 0));
  if exists (select 1 from public.admin_messages m where m.id = p_message and (m.status = 'approved' or (m.status = 'prepared' and not m.requires_approval))) then
    if (select count(*) from public.admin_messages x where pg_catalog.lower(x.created_by_email) = pg_catalog.lower(v_m.created_by_email) and x.sent_started_at > pg_catalog.now() - interval '24 hours') >= 5 then
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
$start$;

-- ---------------------------------------------------------------------------------------
-- Self-check (LAST statement): the FINAL state after 0265 and 0273 is exactly as intended. Raises on anything missing or extra.
-- ---------------------------------------------------------------------------------------
do $check$
declare
  r record;
  problems text[] := '{}';
  tables text[] := array['notification_deliveries', 'push_subscriptions', 'admin_messages', 'admin_message_recipients', 'admin_message_events', 'notification_settings', 'notification_setting_changes'];
  functions text[] := array['create_admin_message', 'record_admin_message_progress', 'finish_admin_message_send', 'notification_in_quiet_hours', 'claim_notification', 'release_notification', 'mark_notification_sent', 'stale_notification_claims', 'resolve_stale_claim', 'unread_notification_count', 'prune_notification_deliveries', 'register_push_subscription', 'email_unsubscribe_stream', 'notification_revoke_devices_on_deletion_request', 'resolve_admin_segment', 'prepare_admin_message', 'submit_admin_message', 'approve_admin_message', 'cancel_admin_message', 'start_admin_message_send', 'admin_message_audit', 'record_admin_message_test', 'set_notification_setting', 'pause_admin_message_send', 'resume_admin_message_send', 'admin_email_eligible_recipients', 'notification_guard_append_only', 'notification_guard_message_edit'];
begin
  -- Table-level privileges, every type including TRUNCATE, REFERENCES, TRIGGER and MAINTAIN, for every role including PUBLIC.
  for r in
    with want(tbl, who, privs) as (values
      ('notification_deliveries', 'service_role', 'SELECT'),
      ('push_subscriptions', 'service_role', 'DELETE,INSERT,SELECT,UPDATE'),
      ('push_subscriptions', 'authenticated', 'DELETE'),
      ('admin_messages', 'service_role', 'SELECT'),
      ('admin_message_recipients', 'service_role', 'SELECT'),
      ('admin_message_events', 'service_role', 'SELECT'),
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

  -- Column-level privileges: the five readable columns of push_subscriptions for authenticated, and the two outcome columns of the recipients for the service role.
  for r in
    with want_cols(col, who, priv) as (values
      ('push_subscriptions.id', 'authenticated', 'SELECT'),
      ('push_subscriptions.ua_short', 'authenticated', 'SELECT'),
      ('push_subscriptions.created_at', 'authenticated', 'SELECT'),
      ('push_subscriptions.last_seen_at', 'authenticated', 'SELECT'),
      ('push_subscriptions.revoked_at', 'authenticated', 'SELECT'),
      ('admin_message_recipients.push_outcome', 'service_role', 'UPDATE'),
      ('admin_message_recipients.email_outcome', 'service_role', 'UPDATE')
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
      ('create_admin_message', 'service_role'),
      ('record_admin_message_progress', 'service_role'),
      ('finish_admin_message_send', 'service_role'),
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
  -- Definers: every function of the migration is a security definer and never immutable, except the three allow-listed invoker functions (named in the header).
  for r in
    select p.proname::text as fn
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = any (functions)
       and (not p.prosecdef or p.provolatile = 'i')
       and p.proname <> all (array['notification_guard_append_only', 'notification_guard_message_edit', 'notification_in_quiet_hours'])
  loop
    problems := problems || format('function %s is not a security definer or is immutable and is not on the allow-list', r.fn);
  end loop;
  for r in
    select p.proname::text as fn
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = any (array['notification_guard_append_only', 'notification_guard_message_edit', 'notification_in_quiet_hours']) and p.provolatile = 'i'
  loop
    problems := problems || format('allow-listed function %s is immutable', r.fn);
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

  -- N1B part B: the flag_state column and its range, the host list inside the device registration, the per-message lock in the start function, and the limits that count by address.
  if not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'admin_message_events' and c.column_name = 'flag_state' and c.data_type = 'smallint' and c.is_nullable = 'YES') then
    problems := problems || 'admin_message_events.flag_state is missing or not a nullable smallint';
  end if;
  if not exists (select 1 from pg_constraint co where co.conrelid = 'public.admin_message_events'::regclass and co.conname = 'admin_message_events_flag_state_check' and co.contype = 'c' and pg_get_constraintdef(co.oid) like '%flag_state >= 1%' and pg_get_constraintdef(co.oid) like '%flag_state <= 15%') then
    problems := problems || 'admin_message_events_flag_state_check is missing or not 1..15';
  end if;
  for r in
    select k.needle from unnest(array['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.apple.com', 'notify.windows.com', 'host_not_allowed']) k(needle)
     where position(k.needle in (select pg_get_functiondef(p.oid) from pg_proc p where p.oid = 'public.register_push_subscription(text, text, text, text, text)'::regprocedure)) = 0
  loop
    problems := problems || format('register_push_subscription does not hold %s', r.needle);
  end loop;
  if position('hashtextextended(p_message::text, 3)' in (select pg_get_functiondef(p.oid) from pg_proc p where p.oid = 'public.start_admin_message_send(uuid, uuid)'::regprocedure)) = 0 then
    problems := problems || 'start_admin_message_send takes no per-message lock';
  end if;
  for r in
    select k.fn from unnest(array['public.start_admin_message_send(uuid, uuid)', 'public.prepare_admin_message(uuid, uuid, integer)']) k(fn)
     where position('lower(x.created_by_email)' in (select pg_get_functiondef(p.oid) from pg_proc p where p.oid = k.fn::regprocedure)) = 0
  loop
    problems := problems || format('%s does not count by the creator address', r.fn);
  end loop;

  -- One notice per object, read back from the catalog.
  for r in
    select t.table_name::text as tbl, string_agg(t.grantee::text || ':' || t.privilege_type::text, ' ' order by t.grantee, t.privilege_type) as granted
      from information_schema.role_table_grants t
     where t.table_schema = 'public' and t.table_name = any (tables) and t.grantee <> 'postgres'
     group by t.table_name
     order by t.table_name
  loop
    raise notice '0273 grants on %: %', r.tbl, r.granted;
  end loop;

  if array_length(problems, 1) is not null then
    raise exception '0273 self-check: %', array_to_string(problems, '; ');
  end if;
  raise notice '0273 self-check: ok';
end
$check$;
