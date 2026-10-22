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
    grant select, insert, update, delete on public.admin_messages to service_role;
    grant insert on public.admin_message_events to service_role;
    revoke update (push_outcome, email_outcome) on public.admin_message_recipients from service_role;
    grant select, insert, update, delete on public.admin_message_recipients to service_role;
    grant insert, update, delete on public.notification_deliveries to service_role;
  end if;
end
$restore$;
