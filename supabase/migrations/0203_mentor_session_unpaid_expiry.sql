-- 0203: an unpaid mentor booking expires when its slot starts, and the slot is released.
--
-- THE PROBLEM (the owner's own test booking). book_mentor_session (0133/0174) locks the slot (is_booked = true) and inserts the
-- session as `pending_payment` BEFORE any payment exists. Nothing ever undid that: the sweep (runMentorshipSweep) only handles
-- `awaiting_confirmation`, so a mentee who never pays leaves the session `pending_payment` and the slot held FOREVER. The mentor's
-- profile then says "No open slots right now" for a slot nobody is going to use, and the mentee's page listed a 17 Sep booking, two
-- weeks past, as "Upcoming", with no way to pay or cancel.
--
-- WHAT THIS ADDS
--   1. Three terminal statuses on mentorship_sessions: expired_unpaid, cancelled_by_mentee, payment_needs_refund.
--   2. The one-session-per-slot rule becomes one LIVE session per slot (a partial unique index). The old UNIQUE (availability_slot_id)
--      made a released slot impossible to book again: the dead session still owned the slot id. Dead sessions keep their slot id
--      (history, and the FK), they just stop counting.
--   3. expire_unpaid_mentor_sessions(p_now): expires every unpaid booking whose slot has started AND releases each slot, in ONE
--      statement (data-modifying CTEs run to completion together), the 0035 pattern: check and act together, never read-then-write.
--   4. cancel_unpaid_mentor_session(p_session_id, p_mentee_id): the mentee cancels their own unpaid booking; same single statement.
--   5. settle_late_mentor_payment(p_session_id, p_now): a Paystack confirmation that arrives for a booking that already expired or
--      was cancelled. Money is NEVER silently kept: if the slot is still free and ahead, the booking is reinstated (awaiting the
--      mentor, slot locked again); otherwise it is marked payment_needs_refund, which the admin ops badge counts.
--
-- ADDITIVE IN EFFECT. The old code only ever writes the old statuses, so widening the CHECK is invisible to it, and the partial index
-- is no weaker than the constraint it replaces for any session the old code can create. Apply BEFORE the code that uses it merges
-- (CLAUDE.md), after the dry run in the PR confirms exactly which rows the first sweep will touch.

-- 1. Statuses ----------------------------------------------------------------------------------------------------------------------
alter table public.mentorship_sessions drop constraint mentorship_sessions_status_check;
alter table public.mentorship_sessions add constraint mentorship_sessions_status_check check (
  status in (
    'pending_payment', 'awaiting_confirmation', 'confirmed', 'completed',
    'cancelled_mentor_no_confirm', 'refunded',
    'expired_unpaid', 'cancelled_by_mentee', 'payment_needs_refund'
  )
);

comment on column public.mentorship_sessions.status is
  'pending_payment -> awaiting_confirmation -> confirmed -> completed; cancelled_mentor_no_confirm and refunded (0133); expired_unpaid (unpaid when the slot started) and cancelled_by_mentee (mentee cancelled while unpaid) release the slot (0203); payment_needs_refund = a payment arrived after the booking had lapsed and the slot could not be restored, so the money must be returned (0203). The last three hold no slot.';

-- 2. One LIVE session per slot -----------------------------------------------------------------------------------------------------
alter table public.mentorship_sessions drop constraint mentorship_sessions_availability_slot_id_key;

create unique index mentorship_sessions_live_slot_key
  on public.mentorship_sessions (availability_slot_id)
  where status not in ('expired_unpaid', 'cancelled_by_mentee', 'payment_needs_refund');

-- 3. Expire unpaid bookings and release their slots, atomically ---------------------------------------------------------------------
create or replace function public.expire_unpaid_mentor_sessions(p_now timestamptz default now())
returns table (session_id uuid, slot_id uuid)
language sql
security definer
set search_path = public
as $$
  with expired as (
    update public.mentorship_sessions
       set status = 'expired_unpaid', updated_at = p_now
     where status = 'pending_payment'
       and scheduled_start <= p_now
    returning id, availability_slot_id
  ),
  released as (
    update public.mentor_availability_slots s
       set is_booked = false
      from expired e
     where s.id = e.availability_slot_id
    returning s.id
  )
  select e.id, e.availability_slot_id from expired e;
$$;

comment on function public.expire_unpaid_mentor_sessions(timestamptz) is
  'Expires every pending_payment session whose slot has started and releases each slot, in one statement. Idempotent: a second call finds nothing. service_role only.';

-- 4. The mentee cancels their own unpaid booking ----------------------------------------------------------------------------------------
create or replace function public.cancel_unpaid_mentor_session(p_session_id uuid, p_mentee_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with cancelled as (
    update public.mentorship_sessions
       set status = 'cancelled_by_mentee', updated_at = now()
     where id = p_session_id
       and mentee_id = p_mentee_id
       and status = 'pending_payment'
    returning availability_slot_id
  ),
  released as (
    update public.mentor_availability_slots s
       set is_booked = false
      from cancelled c
     where s.id = c.availability_slot_id
    returning s.id
  )
  select exists (select 1 from cancelled);
$$;

comment on function public.cancel_unpaid_mentor_session(uuid, uuid) is
  'Cancels the mentee''s own pending_payment session and releases its slot, in one statement. False when there was nothing to cancel (not theirs, already paid, already lapsed). service_role only; the caller resolves p_mentee_id from the session.';

-- 5. A payment that arrives for a booking that already lapsed ---------------------------------------------------------------------------
create or replace function public.settle_late_mentor_payment(p_session_id uuid, p_now timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_slot uuid;
  v_locked uuid;
begin
  -- The row lock serialises this against the expiry sweep and a cancel: whichever got there first has finished.
  select status, availability_slot_id into v_status, v_slot
    from public.mentorship_sessions where id = p_session_id for update;

  if not found then
    return 'not_found';
  end if;
  if v_status not in ('expired_unpaid', 'cancelled_by_mentee') then
    -- pending_payment is the normal path (fulfilment handles it); anything else was already settled.
    return 'not_late';
  end if;

  -- Take the slot back only if it is still free AND still ahead. Conditional UPDATE: check and act in one statement.
  update public.mentor_availability_slots
     set is_booked = true
   where id = v_slot and is_booked = false and start_at > p_now
  returning id into v_locked;

  if v_locked is not null then
    update public.mentorship_sessions set status = 'awaiting_confirmation', updated_at = p_now where id = p_session_id;
    return 'reinstated';
  end if;

  -- The slot has passed or someone else booked it. The mentee paid for something that no longer exists: it must be refunded.
  update public.mentorship_sessions set status = 'payment_needs_refund', updated_at = p_now where id = p_session_id;
  return 'needs_refund';
end;
$$;

comment on function public.settle_late_mentor_payment(uuid, timestamptz) is
  'Called by fulfilment when a successful payment lands on a session that is expired_unpaid or cancelled_by_mentee. Returns reinstated (slot restored, awaiting the mentor), needs_refund (marked payment_needs_refund; the admin ops badge counts it), not_late (nothing to do) or not_found. service_role only.';

-- Grants: these are trusted-server operations (the caller resolves who the mentee is), exactly like book_mentor_session (0133) ----------
revoke all on function public.expire_unpaid_mentor_sessions(timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_unpaid_mentor_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.settle_late_mentor_payment(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.expire_unpaid_mentor_sessions(timestamptz) to service_role;
grant execute on function public.cancel_unpaid_mentor_session(uuid, uuid) to service_role;
grant execute on function public.settle_late_mentor_payment(uuid, timestamptz) to service_role;
