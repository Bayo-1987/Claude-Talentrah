-- Mentor self-service pause.
--
-- THE TRAP THIS AVOIDS: the obvious-looking approach — let a mentor flip
-- their own `status` between 'approved' and 'suspended' — would let a mentor
-- silently undo an admin's for-cause suspension through the same mechanism.
-- `status` is deliberately excluded from the mentor's own column grant
-- (0133) specifically so a client can't move it at all; widening that grant
-- to let self-pause work would reopen exactly the hole 0030's column-grant
-- discipline exists to close.
--
-- THE FIX: a new column, orthogonal to `status`, not a replacement for it.
-- Public listing visibility becomes `status = 'approved' and not
-- self_paused` — an AND, not an OR, so a mentor cannot "unpause" their way
-- around an admin suspension: while status != 'approved', self_paused's
-- value is irrelevant to visibility.
alter table public.mentor_profiles
  add column self_paused boolean not null default false;

comment on column public.mentor_profiles.self_paused is
  'Mentor-controlled pause on their own public listing, independent of status. '
  'Deliberately NOT the same mechanism as an admin suspension (status=''suspended'') '
  '— see 0174''s own header for why folding this into status would let a mentor '
  'undo a for-cause suspension.';

-- Additive column grant — Postgres column privileges accumulate per GRANT,
-- so this does not need to repeat 0133's existing safe-column list (0142's
-- own comment on reviews_verifications explains the same thing).
grant update (self_paused) on public.mentor_profiles to authenticated;

-- mentor_profiles' own SELECT policy (0133): approved-and-public, or visible
-- to the mentor themself. Only the public branch gains the second
-- condition — a mentor must always be able to see (and un-pause) their own
-- row regardless of self_paused.
--
-- USES ALTER POLICY, NOT DROP + CREATE — same reasoning and same exact
-- (select auth.uid()) wrapping as 0161_mentorship_rls_perf_hardening.sql,
-- which already rewrote this policy (and the availability-slots one below)
-- for the project-wide auth_rls_initplan performance fix. A plain
-- drop-and-recreate from 0133's original text would silently revert that
-- fix; ALTER POLICY changes only the expression and leaves the policy's
-- name, command and role list untouched, so this migration only adds the
-- self_paused condition on top of the current live expression.
alter policy "mentor profiles are approved-and-public, or visible to the mentor themself"
  on public.mentor_profiles
  using ((status = 'approved'::text and not self_paused) or user_id = (select auth.uid()));

-- mentor_availability_slots' own SELECT policy (0133) independently joins on
-- mentor_profiles.status — a second, separate gate on the same underlying
-- fact, so it needs the same fix rather than inheriting one from the table
-- above. Same ALTER POLICY reasoning as immediately above.
alter policy "availability is visible for approved mentors, or to the mentor themself"
  on public.mentor_availability_slots
  using (
    mentor_id = (select auth.uid())
    or exists (
      select 1 from public.mentor_profiles mp
      where mp.user_id = mentor_availability_slots.mentor_id
        and mp.status = 'approved'::text
        and not mp.self_paused
    )
  );

-- mentor_public_names() (0167) is SECURITY DEFINER and therefore bypasses
-- RLS entirely on the query it runs internally — it must independently
-- re-derive the same visibility rule rather than inherit it, the same
-- lesson CLAUDE.md documents for promoted_jobs/verified (0109).
create or replace function public.mentor_public_names(p_mentor_ids uuid[])
returns table (user_id uuid, first_name text, last_name text)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return query
    select p.id, p.first_name, p.last_name
    from public.profiles p
    where p.id = any(p_mentor_ids)
      and exists (
        select 1 from public.mentor_profiles mp
        where mp.user_id = p.id
          and mp.status = 'approved'
          and not mp.self_paused
      );
end;
$$;

-- book_mentor_session()'s own booking-time re-check (0133) is the single
-- most load-bearing enforcement point: its existing comment already
-- anticipates "suspended after the slot was already posted" as a real race
-- that RLS/listing-level hiding alone cannot prevent, because a stale or
-- cached slot can still be submitted for booking. Self-pause is exactly the
-- same class of race and needs the same atomic re-check, not just the
-- policy fixes above. Everything below is 0133's own function body,
-- unchanged, with only the self_paused select and check added alongside the
-- existing status check.
create or replace function public.book_mentor_session(
  p_availability_slot_id uuid,
  p_mentee_id uuid,
  p_session_type text
)
returns table (session_id uuid, price_ngn integer, mentor_id uuid)
language plpgsql
security definer
set search_path = public
as $$
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

  /*
   * `mentor_availability_slots.mentor_id` is qualified here, deliberately —
   * this function's own `returns table (..., mentor_id uuid, ...)` clause
   * implicitly declares a PL/pgSQL variable named `mentor_id` in scope for
   * the whole function body, so a bare `mentor_id` in this RETURNING clause
   * is genuinely ambiguous between that output parameter and the table
   * column, and Postgres refuses it outright (42702) rather than guessing.
   * Caught by tests/mentorship/commission-split.test.ts's own DB
   * cross-check, which could not book a single session before this fix.
   */
  update public.mentor_availability_slots
     set is_booked = true
   where id = p_availability_slot_id
     and is_booked = false
  returning mentor_availability_slots.mentor_id, start_at, end_at into v_mentor_id, v_start, v_end;

  if v_mentor_id is null then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  -- A mentor cannot book their own listing as a mentee. Nothing in the
  -- schema shape forbids mentor_id = mentee_id on mentorship_sessions (both
  -- are plain FKs), so this has to be an explicit check here rather than an
  -- assumption from the table definition — see
  -- tests/mentorship/dual-role-isolation.test.ts, which is the guard that
  -- actually proves it.
  if p_mentee_id = v_mentor_id then
    update public.mentor_availability_slots set is_booked = false where id = p_availability_slot_id;
    raise exception 'CANNOT_BOOK_OWN_LISTING';
  end if;

  select status, self_paused, base_price_ngn into v_mentor_status, v_mentor_self_paused, v_base_price
  from public.mentor_profiles where user_id = v_mentor_id;

  if v_mentor_status is distinct from 'approved' then
    -- Roll the lock back — this mentor is not (or no longer) bookable, e.g.
    -- suspended after the slot was already posted.
    update public.mentor_availability_slots set is_booked = false where id = p_availability_slot_id;
    raise exception 'MENTOR_NOT_APPROVED';
  end if;

  if v_mentor_self_paused then
    -- Same race, different cause: the mentor paused their own listing after
    -- the slot was already posted (or the mentee's booking UI had it cached
    -- from before the pause). Listing/slot visibility already hides this in
    -- the common case; this is the atomic backstop for the case it can't.
    update public.mentor_availability_slots set is_booked = false where id = p_availability_slot_id;
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
$$;
